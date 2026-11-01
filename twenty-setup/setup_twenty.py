#!/usr/bin/env python3
"""Create Source Easy custom objects + fields in Twenty via the metadata API.

  export TWENTY_URL=https://sourceeasy.in
  export TWENTY_API_KEY=...   # Settings -> APIs & Webhooks -> create key
  python3 setup_twenty.py [--dry-run] [--schema schema.json]

Idempotent: existing objects/fields (matched by name) are skipped, so it is
safe to re-run after adding fields to schema.json. Stdlib only.
"""
import argparse, json, os, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PALETTE = ["blue", "green", "orange", "purple", "red", "turquoise", "sky", "yellow", "pink", "gray"]


def build_field_input(object_id, f, ids):
    inp = {"objectMetadataId": object_id, "name": f["name"], "label": f["label"],
           "type": f["type"], "isNullable": True}
    if f.get("description"):
        inp["description"] = f["description"]
    if f.get("isUnique"):
        inp["isUnique"] = True
    if f.get("settings"):
        inp["settings"] = f["settings"]
    if f["type"] in ("SELECT", "MULTI_SELECT"):
        inp["options"] = [{"label": o.replace("_", " ").title(), "value": o,
                           "position": i, "color": PALETTE[i % len(PALETTE)]}
                          for i, o in enumerate(f["options"])]
    if f["type"] == "RELATION":
        inp["relationCreationPayload"] = {
            "type": "MANY_TO_ONE", "targetObjectMetadataId": ids[f["target"]],
            "targetFieldLabel": f["targetLabel"], "targetFieldIcon": "IconLink"}
    return inp


class Twenty:
    def __init__(self, url, key, dry=False):
        self.endpoint = url.rstrip("/") + "/metadata"
        self.key, self.dry = key, dry

    def gql(self, query, variables=None):
        body = json.dumps({"query": query, "variables": variables or {}}).encode()
        req = urllib.request.Request(self.endpoint, data=body, headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {self.key}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            raise SystemExit(f"HTTP {e.code}: {e.read().decode()[:500]}")
        if data.get("errors"):
            raise RuntimeError(json.dumps(data["errors"])[:800])
        return data["data"]

    def existing(self):
        d = self.gql("""query { objects(paging:{first:500}) { edges { node {
              id nameSingular fieldsList { name } } } } }""")
        return {e["node"]["nameSingular"]: {"id": e["node"]["id"],
                "fields": {f["name"] for f in e["node"]["fieldsList"]}}
                for e in d["objects"]["edges"]}

    def create_object(self, o):
        inp = {k: o[k] for k in ("nameSingular", "namePlural", "labelSingular",
                                 "labelPlural", "icon", "description")}
        if self.dry:
            print(f"  [dry] createOneObject {o['nameSingular']}")
            return f"dry-{o['nameSingular']}"
        d = self.gql("mutation($input: CreateOneObjectInput!){ createOneObject(input:$input){ id } }",
                     {"input": {"object": inp}})
        return d["createOneObject"]["id"]

    def create_field(self, inp):
        if self.dry:
            print(f"  [dry] createOneField {inp['name']} ({inp['type']})")
            return
        self.gql("mutation($input: CreateOneFieldMetadataInput!){ createOneField(input:$input){ id } }",
                 {"input": {"field": inp}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", default=os.path.join(HERE, "schema.json"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    schema = json.load(open(a.schema))
    url, key = os.environ.get("TWENTY_URL"), os.environ.get("TWENTY_API_KEY")
    if not a.dry_run and not (url and key):
        sys.exit("TWENTY_URL and TWENTY_API_KEY must be set (or use --dry-run)")
    tw = Twenty(url or "http://dry", key or "", a.dry_run)
    have = {} if a.dry_run else tw.existing()
    ids = {k: v["id"] for k, v in have.items()}

    # Pass 1: objects (so relations can reference any target)
    for o in schema["objects"]:
        n = o["nameSingular"]
        if n in have:
            print(f"object {n}: exists")
        else:
            print(f"object {n}: creating")
            ids[n] = tw.create_object(o)
            have[n] = {"id": ids[n], "fields": set()}
    # Pass 2: fields (scalars first, relations last)
    for o in schema["objects"]:
        n = o["nameSingular"]
        fields = o["fields"] + schema.get("commonFields", [])
        fields.sort(key=lambda f: f["type"] == "RELATION")
        for f in fields:
            if f["name"] in have[n]["fields"]:
                continue
            print(f"  {n}.{f['name']}: creating")
            try:
                tw.create_field(build_field_input(ids[n], f, ids))
            except RuntimeError as e:
                print(f"    ! failed: {e}")
    print("done")


if __name__ == "__main__":
    main()
