import pathlib
import re
import sys

ver = sys.argv[1]
text = pathlib.Path("CHANGELOG.md").read_text()
wanted = re.compile(r"\[" + re.escape(ver) + r"\]")
body = ""
for part in text.split("\n## ")[1:]:
    head, _, rest = part.partition("\n")
    if wanted.search(head):
        body = rest.strip()
        break
print(body or f"Proxora {ver}")
