import json, os, unittest
import setup_twenty as s


class T(unittest.TestCase):
    def setUp(self):
        self.schema = json.load(open(os.path.join(s.HERE, "schema.json")))

    def test_all_objects_present(self):
        names = {o["nameSingular"] for o in self.schema["objects"]}
        self.assertEqual(names, {"lead", "sourcingRequest", "supplier", "quotation",
                                 "clientApproval", "shippingOrder", "teamMember"})

    def test_relations_target_known_objects(self):
        names = {o["nameSingular"] for o in self.schema["objects"]}
        for o in self.schema["objects"]:
            for f in o["fields"]:
                if f["type"] == "RELATION":
                    self.assertIn(f["target"], names)

    def test_select_options_built(self):
        f = {"name": "currency", "label": "Currency", "type": "SELECT", "options": ["CNY", "USD"]}
        inp = s.build_field_input("obj", f, {})
        self.assertEqual([o["value"] for o in inp["options"]], ["CNY", "USD"])

    def test_lead_ref_shared_and_unique(self):
        objs = {o["nameSingular"]: o for o in self.schema["objects"]}
        for name in ("lead", "sourcingRequest", "quotation", "shippingOrder"):
            self.assertIn("leadRef", [f["name"] for f in objs[name]["fields"]])
        f = next(f for f in objs["lead"]["fields"] if f["name"] == "leadRef")
        self.assertTrue(s.build_field_input("x", f, {})["isUnique"])

    def test_relation_payload(self):
        f = {"name": "lead", "label": "Lead", "type": "RELATION", "target": "lead", "targetLabel": "X"}
        inp = s.build_field_input("obj", f, {"lead": "L1"})
        self.assertEqual(inp["relationCreationPayload"]["targetObjectMetadataId"], "L1")


if __name__ == "__main__":
    unittest.main()
