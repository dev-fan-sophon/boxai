import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ProductionApprovalTest(unittest.TestCase):
    def test_release_requires_reviewers_and_no_bypass(self):
        script = Path(__file__).with_name('check-production-approval.sh')
        reviewer = {'type': 'required_reviewers', 'reviewers': [{'type': 'User', 'reviewer': {'id': 123}}]}
        cases = [
            ('approved-policy', {'can_admins_bypass': False, 'protection_rules': [reviewer]}, 0, True),
            ('no-reviewers', {'can_admins_bypass': False, 'protection_rules': []}, 0, False),
            ('empty-reviewers', {'can_admins_bypass': False, 'protection_rules': [{'type': 'required_reviewers', 'reviewers': []}]}, 0, False),
            ('wait-only', {'can_admins_bypass': False, 'protection_rules': [{'type': 'wait_timer', 'wait_timer': 10}]}, 0, False),
            ('admin-bypass', {'can_admins_bypass': True, 'protection_rules': [reviewer]}, 0, False),
            ('unknown-bypass', {'protection_rules': [reviewer]}, 0, False),
            ('api-denied', {}, 1, False),
        ]
        for name, policy, api_exit, allowed in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'policy.json').write_text(json.dumps(policy))
                gh = root / 'gh'
                gh.write_text('#!/bin/sh\ncat "$POLICY_FILE"\nexit "$API_EXIT"\n')
                gh.chmod(0o755)
                result = subprocess.run(['bash', str(script)], env={
                    **os.environ,
                    'PATH': directory + ':' + os.environ['PATH'],
                    'GITHUB_REPOSITORY': 'test/repo',
                    'POLICY_FILE': str(root / 'policy.json'),
                    'API_EXIT': str(api_exit),
                }, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, allowed, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
