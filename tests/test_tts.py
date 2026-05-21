"""Tests for TTS integration — voice catalog, text cleaning, skill voice mapping."""
import pytest

from integrations.tts import (
    DEFAULT_VOICE,
    SKILL_VOICE_MAP,
    VOICE_CATALOG,
    TTSClient,
    _clean_for_speech,
    _resolve_voice_id,
    list_voices,
)


# ── Voice catalog ────────────────────────────────────────────────────────────

def test_catalog_has_ten_voices():
    assert len(VOICE_CATALOG) == 10


def test_all_voices_have_elevenlabs_id():
    for alias, profile in VOICE_CATALOG.items():
        assert profile.elevenlabs_id, f"{alias} is missing an ElevenLabs voice ID"


def test_all_voices_have_required_fields():
    for alias, profile in VOICE_CATALOG.items():
        assert profile.alias == alias
        assert profile.gender in ("male", "female", "neutral"), f"{alias} has unexpected gender"
        assert profile.style
        assert profile.best_for


def test_default_voice_in_catalog():
    assert DEFAULT_VOICE in VOICE_CATALOG


def test_list_voices_returns_all():
    voices = list_voices()
    assert len(voices) == len(VOICE_CATALOG)


# ── Skill voice map ───────────────────────────────────────────────────────────

def test_skill_voice_map_all_valid_aliases():
    for skill, alias in SKILL_VOICE_MAP.items():
        assert alias in VOICE_CATALOG, f"Skill {skill} maps to unknown voice '{alias}'"


def test_skill_voice_map_covers_all_four_skills():
    for skill in ("citation-audit", "gbp-monitor", "keyword-hygiene", "falcon-report"):
        assert skill in SKILL_VOICE_MAP


def test_client_voice_for_skill():
    client = TTSClient()
    assert client.voice_for_skill("citation-audit") == SKILL_VOICE_MAP["citation-audit"]
    assert client.voice_for_skill("unknown-skill") == DEFAULT_VOICE


# ── Voice ID resolution ───────────────────────────────────────────────────────

def test_resolve_known_alias():
    for alias, profile in VOICE_CATALOG.items():
        assert _resolve_voice_id(alias) == profile.elevenlabs_id


def test_resolve_unknown_passthrough():
    raw_id = "raw-elevenlabs-id-xyz"
    assert _resolve_voice_id(raw_id) == raw_id


def test_resolve_case_insensitive():
    assert _resolve_voice_id("SAGE") == VOICE_CATALOG["sage"].elevenlabs_id
    assert _resolve_voice_id("Rachel") == VOICE_CATALOG["rachel"].elevenlabs_id


# ── Text cleaning ─────────────────────────────────────────────────────────────

def test_clean_strips_markdown_headings():
    text = "## Executive Summary\nThe citation audit found issues."
    result = _clean_for_speech(text)
    assert "##" not in result
    assert "Executive Summary" in result


def test_clean_strips_code_fences():
    text = "Here is code:\n```python\nprint('hello')\n```\nDone."
    result = _clean_for_speech(text)
    assert "```" not in result
    assert "print" not in result
    assert "Done." in result


def test_clean_strips_table_rows():
    text = "Summary\n| Col1 | Col2 |\n|------|------|\n| a | b |\nEnd."
    result = _clean_for_speech(text)
    assert "|" not in result
    assert "End." in result


def test_clean_strips_bold_markers():
    text = "This is **very important** and *emphasized*."
    result = _clean_for_speech(text)
    assert "**" not in result
    assert "*" not in result
    assert "very important" in result


def test_clean_strips_inline_code():
    text = "Run `jarvis skill run citation-audit` to audit."
    result = _clean_for_speech(text)
    assert "`" not in result
    assert "jarvis" not in result
    assert "to audit" in result


def test_clean_strips_html_tags():
    text = "Hello <b>world</b> and <br/> newline."
    result = _clean_for_speech(text)
    assert "<" not in result
    assert "world" in result


def test_clean_collapses_blank_lines():
    text = "Line 1\n\n\n\n\nLine 2"
    result = _clean_for_speech(text)
    assert "\n\n\n" not in result


def test_clean_empty_string():
    assert _clean_for_speech("") == ""


def test_clean_whitespace_only():
    assert _clean_for_speech("   \n\n  ") == ""


# ── TTSClient (no API key) ───────────────────────────────────────────────────

def test_client_no_key_has_no_elevenlabs():
    client = TTSClient(api_key="")
    assert client.has_elevenlabs is False


def test_client_speak_without_key_returns_none(mocker):
    client = TTSClient(api_key="")
    mocker.patch.object(client, "_speak_pyttsx3")  # don't actually play audio
    result = client.speak("Hello world", play=False)
    assert result is None


def test_client_speak_empty_text_returns_none():
    client = TTSClient(api_key="")
    result = client.speak("", play=False)
    assert result is None


def test_client_speak_whitespace_only_returns_none():
    client = TTSClient(api_key="")
    result = client.speak("   ", play=False)
    assert result is None
