import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class StartInfraTest(unittest.TestCase):
    def test_service_selection_and_fail_closed(self):
        script = Path(__file__).with_name('start-infra.sh')
        cases = [
            ('managed', 'BOXAI_POSTGRES_MODE=external\nSQL_DSN=postgresql://app:secret@db.example:20184/boxai?sslmode=verify-full\n', ['redis']),
            ('local', 'SQL_DSN=postgresql://app:secret@127.0.0.1:5432/boxai\n', ['postgres', 'redis']),
            ('wrong-host', 'BOXAI_POSTGRES_MODE=external\nSQL_DSN=postgresql://app:secret@localhost/boxai\n', None),
            ('wrong-mode', 'BOXAI_POSTGRES_MODE=typo\n', None),
        ]
        for name, config, expected in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                env_file = root / '.env'
                env_file.write_text(config)
                docker = root / 'docker'
                docker.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$BOXAI_APP_ROOT/args"\n')
                docker.chmod(0o755)
                result = subprocess.run(['bash', str(script)], env={**os.environ, 'BOXAI_APP_ROOT': directory, 'PATH': directory + ':' + os.environ['PATH']}, capture_output=True, text=True)
                if expected is None:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((root / 'args').exists())
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    args = (root / 'args').read_text().splitlines()
                    self.assertEqual(args, ['compose', '-f', str(root / 'docker-compose.infra.yml'), '--env-file', str(env_file), 'up', '-d', *expected])
                    if name == 'managed':
                        self.assertEqual(env_file.read_text(), config)
                    else:
                        self.assertIn("POSTGRES_USER='app'", env_file.read_text())
                        self.assertIn("POSTGRES_PASSWORD='secret'", env_file.read_text())
                        self.assertIn("POSTGRES_DB='boxai'", env_file.read_text())


if __name__ == '__main__':
    unittest.main()
