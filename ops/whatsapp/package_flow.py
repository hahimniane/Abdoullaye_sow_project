"""Set up the "Send a package" WhatsApp Flow (docs/PACKAGE_PRICE_LIST.md §5).

Steps, run in order (each prints what it did, never a secret):
    python3 ops/whatsapp/package_flow.py key       # RSA key: private half to
                                                   # Secret Manager, public to Meta
    python3 ops/whatsapp/package_flow.py create    # create the Flow + upload JSON
    python3 ops/whatsapp/package_flow.py upload    # re-upload the JSON (after edits)
    python3 ops/whatsapp/package_flow.py health    # status, validation, endpoint health
    python3 ops/whatsapp/package_flow.py publish   # publish (after the deploy)
    python3 ops/whatsapp/package_flow.py enable    # appConfig/whatsappPackageFlow

The Flow JSON comes from my_flutter_app/functions/whatsapp_package_flow.js
(flowJson). Tokens are read from Secret Manager at run time.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

PROJECT = "laawol-a855a"
WABA = "992521863149970"
GRAPH = "https://graph.facebook.com/v21.0"
NAME = "send_a_package"
ENDPOINT = "https://us-central1-laawol-a855a.cloudfunctions.net/whatsappWebhook"
GCLOUD = "/opt/homebrew/bin/gcloud"
ROOT = pathlib.Path(__file__).resolve().parents[2]
FUNCTIONS = ROOT / "my_flutter_app" / "functions"
STATE = pathlib.Path.home() / "laawol-deploy-logs" / "package_flow_id.txt"


def secret(name):
    return subprocess.check_output([GCLOUD, "secrets", "versions", "access",
                                    "latest", "--secret", name,
                                    "--project", PROJECT]).decode().strip()


def call(method, path, data=None, files=None, form=None):
    url = f"{GRAPH}/{path}"
    headers = {"Authorization": "Bearer " + secret("WHATSAPP_ACCESS_TOKEN")}
    body = None
    if files:
        boundary = uuid.uuid4().hex
        parts = []
        for key, value in (form or {}).items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; "
                         f"name=\"{key}\"\r\n\r\n{value}\r\n".encode())
        for key, (filename, content, ctype) in files.items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; "
                         f"name=\"{key}\"; filename=\"{filename}\"\r\n"
                         f"Content-Type: {ctype}\r\n\r\n".encode()
                         + content + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers,
                                 method=method)
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as error:
        return {"error": json.loads(error.read().decode() or "{}")}


def flow_json():
    out = subprocess.check_output(
        ["node", "-e", "process.stdout.write(JSON.stringify("
         "require('./whatsapp_package_flow').flowJson()))"],
        cwd=FUNCTIONS)
    return out


def flow_id():
    if not STATE.exists():
        sys.exit("No flow yet: run `create` first.")
    return STATE.read_text().strip()


def cmd_key():
    exists = subprocess.run([GCLOUD, "secrets", "describe",
                             "WHATSAPP_FLOW_PRIVATE_KEY", "--project",
                             PROJECT], capture_output=True).returncode == 0
    with tempfile.TemporaryDirectory() as tmp:
        private = os.path.join(tmp, "private.pem")
        public = os.path.join(tmp, "public.pem")
        subprocess.check_call(["openssl", "genrsa", "-out", private, "2048"],
                              stderr=subprocess.DEVNULL)
        subprocess.check_call(["openssl", "rsa", "-in", private, "-pubout",
                               "-out", public], stderr=subprocess.DEVNULL)
        if exists:
            subprocess.check_call([GCLOUD, "secrets", "versions", "add",
                                   "WHATSAPP_FLOW_PRIVATE_KEY",
                                   "--data-file", private,
                                   "--project", PROJECT])
        else:
            subprocess.check_call([GCLOUD, "secrets", "create",
                                   "WHATSAPP_FLOW_PRIVATE_KEY",
                                   "--replication-policy", "automatic",
                                   "--data-file", private,
                                   "--project", PROJECT])
        phone_id = secret("WHATSAPP_PHONE_NUMBER_ID")
        result = call("POST", f"{phone_id}/whatsapp_business_encryption",
                      form={"business_public_key":
                            pathlib.Path(public).read_text()})
    print("public key upload:", result)


def upload(fid):
    result = call("POST", f"{fid}/assets",
                  files={"file": ("flow.json", flow_json(),
                                  "application/json")},
                  form={"name": "flow.json", "asset_type": "FLOW_JSON"})
    print("upload:", json.dumps(result, indent=1)[:3000])


def cmd_create():
    if STATE.exists():
        sys.exit(f"Flow already created: {STATE.read_text().strip()}")
    result = call("POST", f"{WABA}/flows",
                  form={"name": NAME, "categories": json.dumps(["OTHER"]),
                        "endpoint_uri": ENDPOINT})
    print("create:", result)
    if "id" not in result:
        sys.exit(1)
    STATE.write_text(result["id"])
    upload(result["id"])


def cmd_health():
    fid = flow_id()
    print(json.dumps(call("GET", f"{fid}?fields=id,name,status,"
                         "validation_errors,health_status,endpoint_uri"),
                     indent=1)[:4000])


def cmd_publish():
    print("publish:", call("POST", f"{flow_id()}/publish"))


def cmd_enable():
    fid = flow_id()
    script = ("const a=require('firebase-admin');a.initializeApp({projectId:"
              f"'{PROJECT}'}});a.firestore().collection('appConfig')"
              ".doc('whatsappPackageFlow').set({flowId:'" + fid +
              "',enabled:true,updatedAt:a.firestore.FieldValue"
              ".serverTimestamp()},{merge:true}).then(()=>console.log("
              "'enabled " + fid + "'))")
    subprocess.check_call(["node", "-e", script], cwd=FUNCTIONS)


COMMANDS = {"key": cmd_key, "create": cmd_create,
            "upload": lambda: upload(flow_id()), "health": cmd_health,
            "publish": cmd_publish, "enable": cmd_enable}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]]()
