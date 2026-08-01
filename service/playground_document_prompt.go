package service

import (
	"fmt"
	"regexp"
	"strings"
)

// MaxPlaygroundDocumentCodeBytes matches the worker's own limit. Rejecting an oversized script
// here saves a round trip and keeps the error next to the model that produced it.
const MaxPlaygroundDocumentCodeBytes = 200_000

// PlaygroundDocumentPrompt describes the state the build script will find on disk. The model is
// told what exists rather than being asked to discover it, because a wrong guess costs a whole
// container run.
type PlaygroundDocumentPrompt struct {
	// Inputs are filenames the user attached, readable at /workspace/in/<name>.
	Inputs []string
	// Previous are the files an earlier build in this conversation produced, readable at
	// /workspace/in/previous/<name>. Their presence turns a request into an edit.
	Previous []string
	// PreviousCode and FailureLog are set only on a self-heal retry.
	PreviousCode string
	FailureLog   string
	// Formats selects which authoring skills are appended. Empty means docx.
	Formats []string
	// HTMLPdf advertises the browser-rendered PDF path.
	HTMLPdf bool
}

// BuildPlaygroundDocumentSystemPrompt returns the system message that turns an ordinary chat
// model into a build-script author. It is prepended by the client to a normal, billed chat call,
// which is why it has to be self-contained: nothing else constrains what comes back.
func BuildPlaygroundDocumentSystemPrompt(p PlaygroundDocumentPrompt) string {
	var b strings.Builder
	b.WriteString(`You produce documents by writing a Python script. Reply with exactly one fenced ` + "```python" + ` block and no prose outside it.

Environment
- Python 3.11. The script runs once, then the container is discarded. There is no network access, so never download anything or call an API.
- Available: python-docx, openpyxl, xlsxwriter, python-pptx, pypdf, pdfplumber, reportlab, fpdf2, img2pdf, lxml, pandas, numpy, matplotlib, pillow, tabulate, striprtf, markdown.
- Fonts for Latin, Vietnamese and CJK are installed and matplotlib is already configured to use them. Do not set fonts yourself.

Contract
- Write every file you want the user to receive into /workspace/out/. Files written anywhere else are discarded.
- Use a short, descriptive, ASCII filename with the correct extension, for example report.docx or revenue.xlsx.
- Produce the real format the user asked for. A .docx must be written with python-docx, not renamed HTML.
- Do not print the document contents. Anything you print is shown to the user as a build log, so keep it to a line or two.
`)

	if len(p.Inputs) > 0 {
		b.WriteString("\nFiles the user attached, already on disk:\n")
		for _, name := range p.Inputs {
			b.WriteString(fmt.Sprintf("- /workspace/in/%s\n", name))
		}
	}
	if len(p.Previous) > 0 {
		b.WriteString("\nThis is an edit, not a new document. The current version is on disk:\n")
		for _, name := range p.Previous {
			b.WriteString(fmt.Sprintf("- /workspace/in/previous/%s\n", name))
		}
		b.WriteString("Open it, apply only the change the user asked for, and save the result into /workspace/out/ under the same filename. Do not rebuild it from scratch: everything the user does not mention must survive unchanged.\n")
	}
	if p.FailureLog != "" {
		b.WriteString("\nYour previous script failed. Fix it and return the corrected script in full.\n")
		if p.PreviousCode != "" {
			b.WriteString("\nPrevious script:\n```python\n")
			b.WriteString(p.PreviousCode)
			b.WriteString("\n```\n")
		}
		b.WriteString("\nError output:\n```\n")
		b.WriteString(p.FailureLog)
		b.WriteString("\n```\n")
	}

	// The skills go last so the most concrete guidance is closest to the model's turn, and they
	// are repeated on retries because each attempt is a fresh, stateless chat call.
	formats := p.Formats
	if len(formats) == 0 {
		formats = []string{"docx"}
	}
	for _, format := range formats {
		if skill := PlaygroundDocumentSkill(format, p.HTMLPdf); skill != "" {
			b.WriteString("\n---\n\n")
			b.WriteString(skill)
		}
	}
	return b.String()
}

var playgroundDocumentFence = regexp.MustCompile("(?s)```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n(.*?)```")

// ExtractPlaygroundDocumentCode pulls the build script out of a chat reply.
//
// Models add commentary around the block no matter how firmly the prompt forbids it, and weaker
// ones emit several blocks — a sketch followed by the real script. The last python block is the
// one they meant; an untagged block is accepted as a fallback so a missing language tag does not
// cost the user a retry.
func ExtractPlaygroundDocumentCode(reply string) string {
	selected := ""
	for _, match := range playgroundDocumentFence.FindAllStringSubmatch(reply, -1) {
		language := strings.ToLower(strings.TrimSpace(match[1]))
		code := strings.TrimSpace(match[2])
		if code == "" {
			continue
		}
		if language == "python" || language == "py" {
			selected = code
			continue
		}
		if language == "" && selected == "" {
			selected = code
		}
	}
	if selected != "" {
		return selected
	}
	// No fence at all. Some models answer with bare code; accept it only when it actually looks
	// like a script rather than an apology.
	trimmed := strings.TrimSpace(reply)
	if strings.Contains(trimmed, "import ") && strings.Contains(trimmed, "/workspace/out") {
		return trimmed
	}
	return ""
}
