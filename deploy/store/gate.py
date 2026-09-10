#!/usr/bin/env python3
"""Read and move Laawol's force-update gate (Firestore appConfig/client).

    gate.py show
    gate.py set --latest-android 39 --min-android 38 --version 1.0.4

The gate blocks the whole app below minSupportedBuild and nags between
minSupportedBuild and latestBuild. The one rule that matters:

    NEVER point minSupportedBuild at a build users cannot yet install.

A build in review, or mid staged-rollout, is not installable - pointing the
minimum at it locks every user out of the app. Raise `latest` on release day
and `min` only once the store is actually serving that build.

Authenticates with gcloud application-default credentials; the doc is written
through the Firestore REST API because client writes are refused by the rules.
"""
import argparse
import json

import google.auth
import google.auth.transport.requests

PROJECT = "car-selling-flutter-app"
DOC = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
       "/databases/(default)/documents/appConfig/client")


def session():
    creds, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/datastore"])
    return google.auth.transport.requests.AuthorizedSession(creds)


def untype(value):
    for key in ("stringValue", "booleanValue", "integerValue"):
        if key in value:
            return int(value[key]) if key == "integerValue" else value[key]
    if "mapValue" in value:
        return {k: untype(v)
                for k, v in value["mapValue"].get("fields", {}).items()}
    return value


def read(sess):
    resp = sess.get(DOC, timeout=60)
    if resp.status_code >= 400:
        raise SystemExit(f"read -> {resp.status_code}\n{resp.text}")
    return {k: untype(v) for k, v in resp.json().get("fields", {}).items()}


def show():
    doc = read(session())
    for key in ("enabled", "latestVersionName", "latestBuild",
                "minSupportedBuild"):
        print(f"  {key}: {doc.get(key)}")


def set_gate(args):
    sess = session()
    doc = read(sess)
    latest = dict(doc.get("latestBuild") or {})
    minimum = dict(doc.get("minSupportedBuild") or {})
    if args.latest_android:
        latest["android"] = args.latest_android
    if args.latest_ios:
        latest["ios"] = args.latest_ios
    if args.min_android:
        minimum["android"] = args.min_android
    if args.min_ios:
        minimum["ios"] = args.min_ios

    for platform, floor in minimum.items():
        ceiling = latest.get(platform)
        if ceiling is not None and int(floor) > int(ceiling):
            raise SystemExit(
                f"refusing: minSupportedBuild.{platform}={floor} is above "
                f"latestBuild.{platform}={ceiling} - that locks users out")

    fields = {
        "latestBuild": {"mapValue": {"fields": {
            k: {"integerValue": str(v)} for k, v in latest.items()}}},
        "minSupportedBuild": {"mapValue": {"fields": {
            k: {"integerValue": str(v)} for k, v in minimum.items()}}},
    }
    mask = "latestBuild&updateMask.fieldPaths=minSupportedBuild"
    if args.version:
        fields["latestVersionName"] = {"stringValue": args.version}
        mask += "&updateMask.fieldPaths=latestVersionName"

    resp = sess.patch(f"{DOC}?updateMask.fieldPaths={mask}",
                      data=json.dumps({"fields": fields}),
                      headers={"Content-Type": "application/json"}, timeout=60)
    if resp.status_code >= 400:
        raise SystemExit(f"write -> {resp.status_code}\n{resp.text}")
    print("gate now:")
    show()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    setter = sub.add_parser("set")
    setter.add_argument("--latest-android", type=int)
    setter.add_argument("--latest-ios", type=int)
    setter.add_argument("--min-android", type=int)
    setter.add_argument("--min-ios", type=int)
    setter.add_argument("--version")
    args = parser.parse_args()
    if args.cmd == "show":
        show()
    else:
        set_gate(args)
