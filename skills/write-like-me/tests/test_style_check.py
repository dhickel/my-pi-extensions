from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "style_check.py"
SPEC = importlib.util.spec_from_file_location("write_like_me_style_check", SCRIPT)
assert SPEC and SPEC.loader
STYLE_CHECK = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = STYLE_CHECK
SPEC.loader.exec_module(STYLE_CHECK)


class StyleCheckTests(unittest.TestCase):
    def findings(self, text: str, mode: str = "final"):
        return STYLE_CHECK.check_text(text, mode=mode)

    def codes(self, text: str, mode: str = "final") -> set[str]:
        return {finding.code for finding in self.findings(text, mode)}

    def test_clean_technical_passage_has_no_findings(self):
        text = (
            "Random Forest fits the current dataset because it represents non-linear relationships "
            "without requiring a large training set. Each tree evaluates a different sample of records, "
            "which reduces the effect of any single split. A linear model would train faster, but it would "
            "not represent the interactions found in the data. Given these constraints, Random Forest is "
            "the more appropriate choice."
        )
        self.assertEqual([], self.findings(text))

    def test_literal_em_dash_is_an_error(self):
        text = "The first control" + chr(0x2014) + "not the second control applies."
        self.assertIn("EMD001", self.codes(text))

    def test_encoded_em_dash_is_an_error(self):
        self.assertIn("EMD002", self.codes("The first control &mdash; not the second applies."))
        self.assertIn("EMD002", self.codes(r"The first control \u2014 not the second applies."))

    def test_spaced_double_hyphen_is_an_error(self):
        self.assertIn("EMD003", self.codes("The control -- not the exception applies."))

    def test_normal_hyphens_are_allowed(self):
        text = "The non-linear model uses role-based controls for the 2025-2026 period."
        self.assertFalse(any(code.startswith("EMD") for code in self.codes(text)))

    def test_stock_phrase_is_an_error(self):
        self.assertIn(
            "PHR001",
            self.codes("It is important to note that the model uses all available records."),
        )

    def test_generic_sentence_starter_is_an_error(self):
        self.assertIn(
            "PHR002",
            self.codes("The model uses two features. Furthermore, it uses a normalized target."),
        )

    def test_duplicate_sentence_is_an_error(self):
        sentence = "The model uses five features to predict the target value accurately."
        self.assertIn("DUP001", self.codes(sentence + " " + sentence))

    def test_duplicate_paragraph_is_an_error(self):
        paragraph = (
            "The access review identifies accounts whose permissions exceed current job requirements. "
            "The administrator removes each unnecessary permission after approval."
        )
        self.assertIn("DUP002", self.codes(paragraph + "\n\n" + paragraph))

    def test_near_duplicate_paragraph_is_a_warning(self):
        text = (
            "The model uses normalized features to keep large numeric values from dominating training. "
            "This scaling keeps each measured input within the same numeric range.\n\n"
            "The model applies normalized features so large numeric values do not dominate training. "
            "This scaling places every measured input within the same numeric range."
        )
        findings = self.findings(text)
        self.assertTrue(any(item.code == "DUP101" and item.severity == "warning" for item in findings))

    def test_repeated_word_is_an_error(self):
        self.assertIn("MEC001", self.codes("The model can can process the input."))

    def test_placeholder_depends_on_mode(self):
        text = "The measured error was [SOURCE NEEDED]."
        self.assertIn("FIN001", self.codes(text, mode="final"))
        self.assertNotIn("FIN001", self.codes(text, mode="draft"))

    def test_long_sentence_is_a_warning(self):
        words = ["word"] * 41
        findings = self.findings(" ".join(words) + ".")
        self.assertTrue(any(item.code == "RHY101" and item.severity == "warning" for item in findings))

    def test_generic_term_is_a_warning(self):
        findings = self.findings("The system provides a robust method for account review.")
        self.assertTrue(any(item.code == "DIC101" and item.severity == "warning" for item in findings))

    def test_question_and_exclamation_are_warnings(self):
        findings = self.findings("Does the control apply? The control applies!")
        self.assertEqual(2, sum(item.code == "TON101" for item in findings))


if __name__ == "__main__":
    unittest.main()
