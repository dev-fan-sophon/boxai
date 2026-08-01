#!/usr/bin/env node
// Exercises the paths that need a real container, which the vitest suite cannot reach.
//
//   npm run dev            # in one terminal, needs Docker running
//   npm run test:integration
//
// Against a deployed worker instead:
//   DOC_BUILDER_URL=https://doc-builder.you-box.com DOC_BUILDER_SECRET=… npm run test:integration
import { createHmac } from "node:crypto";

const BASE_URL = process.env.DOC_BUILDER_URL ?? "http://127.0.0.1:8787";
const SECRET = process.env.DOC_BUILDER_SECRET ?? "test-secret";

async function callBuild(body) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");
  const response = await fetch(`${BASE_URL}/v1/build`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-boxai-timestamp": String(timestamp),
      "x-boxai-signature": signature,
    },
    body: raw,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

const CASES = [
  {
    name: "produces a verified docx",
    body: {
      job_id: `it-docx-${Date.now()}`,
      sandbox_key: "doc:it:docx",
      code: [
        "import docx",
        "document = docx.Document()",
        "document.add_heading('Báo cáo quý 3', level=1)",
        "document.add_paragraph('Tiếng Việt có dấu, 中文也要能排版。')",
        "document.save('/workspace/out/report.docx')",
      ].join("\n"),
    },
    check(result) {
      if (result.status !== "completed") throw new Error(`status ${result.status}: ${result.error}`);
      const artifact = result.artifacts.find((entry) => entry.name === "report.docx");
      if (!artifact) throw new Error("report.docx missing from the manifest");
      if (!artifact.verified) throw new Error("report.docx did not survive being reopened");
      if (artifact.bytes <= 0) throw new Error("report.docx is empty");
    },
  },
  {
    name: "refuses outbound network access",
    body: {
      job_id: `it-egress-${Date.now()}`,
      sandbox_key: "doc:it:egress",
      code: [
        "import urllib.request",
        "try:",
        "    urllib.request.urlopen('https://example.com', timeout=10).read(16)",
        "    print('EGRESS_RESULT=reached')",
        "except Exception as err:",
        "    print(f'EGRESS_RESULT=blocked {type(err).__name__}')",
        "open('/workspace/out/egress.txt', 'w').write('done')",
      ].join("\n"),
    },
    check(result) {
      const stdout = result.logs?.stdout ?? "";
      if (stdout.includes("EGRESS_RESULT=reached")) {
        throw new Error("the sandbox reached the public internet — enableInternet is not in effect");
      }
      if (!stdout.includes("EGRESS_RESULT=blocked")) {
        throw new Error(`egress probe did not report a result: ${stdout}`);
      }
    },
  },
  {
    // The whole edit story rests on this: if the previous version does not appear on disk, the
    // model silently regenerates and everything the user did not mention disappears.
    name: "injects the previous version for an edit",
    async run() {
      const first = await callBuild({
        job_id: `it-prev-a-${Date.now()}`,
        sandbox_key: "doc:it:prev",
        code: [
          "import docx",
          "d = docx.Document()",
          "d.add_paragraph('ĐOẠN GỐC PHẢI GIỮ NGUYÊN')",
          "d.save('/workspace/out/report.docx')",
        ].join("\n"),
      });
      if (first.status !== "completed") throw new Error(`first build failed: ${first.error}`);
      const original = first.artifacts.find((entry) => entry.name === "report.docx");
      if (!original) throw new Error("first build produced no report.docx");

      const second = await callBuild({
        job_id: `it-prev-b-${Date.now()}`,
        sandbox_key: "doc:it:prev",
        previous: [{ path: "report.docx", r2_key: original.r2_key }],
        code: [
          "import docx",
          "d = docx.Document('/workspace/in/previous/report.docx')",
          "texts = [p.text for p in d.paragraphs]",
          "assert 'ĐOẠN GỐC PHẢI GIỮ NGUYÊN' in texts, texts",
          "print('PREVIOUS_OK')",
          "d.add_paragraph('đoạn mới')",
          "d.save('/workspace/out/report.docx')",
        ].join("\n"),
      });
      if (second.status !== "completed") throw new Error(`edit build failed: ${second.error}`);
      if (!(second.logs?.stdout ?? "").includes("PREVIOUS_OK")) {
        throw new Error("the previous version never reached /workspace/in/previous/");
      }
    },
  },
  {
    // Browser Run's quickAction has no local emulation, so this only means anything against a
    // deployed worker.
    name: "renders a Chromium PDF from HTML",
    remoteOnly: true,
    body: {
      job_id: `it-htmlpdf-${Date.now()}`,
      sandbox_key: "doc:it:htmlpdf",
      code: [
        `html = ${JSON.stringify(
          '<!doctype html><html lang="vi"><head><meta charset="utf-8">' +
            "<style>@page{size:A4;margin:0}body{font-family:'Noto Sans',Arial,sans-serif;padding:16mm}" +
            "h1{color:#1F4E79}</style></head><body><h1>Hóa đơn thử nghiệm</h1>" +
            "<p>Tiếng Việt có dấu đầy đủ.</p></body></html>",
        )}`,
        "open('/workspace/out/invoice.pdf.html', 'w', encoding='utf-8').write(html)",
      ].join("\n"),
    },
    check(result) {
      if (result.status !== "completed") throw new Error(`status ${result.status}: ${result.error}`);
      const pdf = result.artifacts.find((entry) => entry.name === "invoice.pdf");
      if (!pdf) throw new Error(`no invoice.pdf: ${result.artifacts.map((a) => a.name).join(", ")}`);
      if (pdf.mime !== "application/pdf") throw new Error(`wrong mime: ${pdf.mime}`);
      if (pdf.bytes < 1000) throw new Error(`suspiciously small PDF: ${pdf.bytes} bytes`);
      if (result.artifacts.some((entry) => entry.name.endsWith(".html"))) {
        throw new Error("the HTML source was delivered to the user alongside the PDF");
      }
    },
  },
  {
    name: "reports a failing script instead of hanging",
    body: {
      job_id: `it-error-${Date.now()}`,
      sandbox_key: "doc:it:error",
      code: "raise ValueError('deliberate failure')",
    },
    check(result) {
      if (result.status !== "failed") throw new Error(`expected failure, got ${result.status}`);
      if (!(result.logs?.stderr ?? "").includes("deliberate failure")) {
        throw new Error("the traceback never made it back, so self-heal would have nothing to work with");
      }
    },
  },
];

const isLocal = BASE_URL.includes("127.0.0.1") || BASE_URL.includes("localhost");

let failed = 0;
let skipped = 0;
for (const testCase of CASES) {
  if (testCase.remoteOnly && isLocal) {
    skipped += 1;
    console.log(`skip ${testCase.name} (needs a deployed worker)`);
    continue;
  }
  try {
    const started = Date.now();
    if (testCase.run) {
      await testCase.run();
    } else {
      testCase.check(await callBuild(testCase.body));
    }
    console.log(`ok   ${testCase.name} (${Date.now() - started}ms)`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${testCase.name}\n     ${err.message}`);
  }
}

const ran = CASES.length - skipped;
console.log(failed === 0 ? `\n${ran} passed, ${skipped} skipped` : `\n${failed} of ${ran} failed`);
process.exit(failed === 0 ? 0 : 1);
