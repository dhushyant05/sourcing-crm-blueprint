import base64, json, os, tempfile, threading, unittest, urllib.request, urllib.error
from http.server import ThreadingHTTPServer

tmp = tempfile.mkdtemp()
os.makedirs(f"{tmp}/daily/twenty")
open(f"{tmp}/daily/twenty/twenty_20261031T020000Z.sql.gz", "wb").write(b"x" * 10)
users = f"{tmp}/users.json"
os.environ["BACKUP_ROOT"], os.environ["USERS_FILE"] = tmp, users
import app  # noqa: E402
json.dump({"sa": {"role": "super_admin", "hash": app.hash_password("pw")},
           "ia": {"role": "india_admin", "hash": app.hash_password("pw")},
           "st": {"role": "india_staff", "hash": app.hash_password("pw")}}, open(users, "w"))


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"

    def get(self, path, user=None):
        req = urllib.request.Request(self.base + path)
        if user:
            req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:pw".encode()).decode())
        try:
            r = urllib.request.urlopen(req)
            return r.status, r.read().decode(errors="replace")
        except urllib.error.HTTPError as e:
            return e.code, ""

    def test_super_sees_links(self):
        code, body = self.get("/", "sa")
        self.assertEqual(code, 200)
        self.assertIn("/download?f=", body)

    def test_office_admin_no_links(self):
        code, body = self.get("/", "ia")
        self.assertEqual(code, 200)
        self.assertIn("twenty_20261031T020000Z", body)
        self.assertNotIn("/download?f=", body)

    def test_download_enforced(self):
        self.assertEqual(self.get("/download?f=daily/twenty/twenty_20261031T020000Z.sql.gz", "ia")[0], 403)
        self.assertEqual(self.get("/download?f=daily/twenty/twenty_20261031T020000Z.sql.gz", "sa")[0], 200)
        self.assertEqual(self.get("/download?f=../users.json", "sa")[0], 404)

    def test_staff_and_anon(self):
        self.assertEqual(self.get("/", "st")[0], 403)
        self.assertEqual(self.get("/")[0], 401)


if __name__ == "__main__":
    unittest.main()
