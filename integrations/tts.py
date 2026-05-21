"""
Text-to-speech integration for Jarvis-Pro.

Primary: ElevenLabs (high-quality, natural voices)
Fallback: pyttsx3 offline TTS (no API key needed)

Usage:
    from integrations.tts import speak, list_voices, TTSClient
    speak("Citation audit complete for KaplunMarx.")
    speak("Here is your weekly report.", voice="sage")
"""
from __future__ import annotations

import io
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Optional

from core.config import settings
from core.logger import logger

# ── Voice catalog ────────────────────────────────────────────────────────────
# Each voice has a canonical alias, ElevenLabs voice ID, and a description
# so operators can pick the right tone for different output types.

@dataclass(frozen=True)
class VoiceProfile:
    alias: str
    elevenlabs_id: str
    gender: str
    style: str
    best_for: str

VOICE_CATALOG: dict[str, VoiceProfile] = {
    # ── Professional / agency ──────────────────────────────────────────────
    "rachel": VoiceProfile(
        alias="rachel",
        elevenlabs_id="21m00Tcm4TlvDq8ikWAM",
        gender="female",
        style="warm, professional",
        best_for="client reports, executive summaries",
    ),
    "drew": VoiceProfile(
        alias="drew",
        elevenlabs_id="29vD33N1CtxCmqQRPOHJ",
        gender="male",
        style="confident, clear",
        best_for="action plans, audit findings",
    ),
    "clyde": VoiceProfile(
        alias="clyde",
        elevenlabs_id="2EiwWnXFnvU5JabPnv8n",
        gender="male",
        style="deep, authoritative",
        best_for="strategy briefings, boardroom tone",
    ),
    # ── Conversational / assistant ─────────────────────────────────────────
    "bella": VoiceProfile(
        alias="bella",
        elevenlabs_id="EXAVITQu4vr4xnSDxMaL",
        gender="female",
        style="friendly, enthusiastic",
        best_for="quick updates, status summaries",
    ),
    "adam": VoiceProfile(
        alias="adam",
        elevenlabs_id="pNInz6obpgDQGcFmaJgB",
        gender="male",
        style="neutral, crisp",
        best_for="data-heavy reports, metrics readouts",
    ),
    "domi": VoiceProfile(
        alias="domi",
        elevenlabs_id="AZnzlk1XvdvUeBnXmlld",
        gender="female",
        style="strong, direct",
        best_for="competitor analysis, gap reports",
    ),
    # ── Narrative / long-form ──────────────────────────────────────────────
    "elli": VoiceProfile(
        alias="elli",
        elevenlabs_id="MF3mGyEYCl7XYWbV9V6O",
        gender="female",
        style="expressive, storytelling",
        best_for="research summaries, longer narratives",
    ),
    "josh": VoiceProfile(
        alias="josh",
        elevenlabs_id="TxGEqnHWrfWFTfGW9XjX",
        gender="male",
        style="young, approachable",
        best_for="keyword hygiene reports, casual briefings",
    ),
    "sam": VoiceProfile(
        alias="sam",
        elevenlabs_id="yoZ06aMxZJJ28mfd3POQ",
        gender="male",
        style="raspy, distinctive",
        best_for="GBP monitor alerts, priority items",
    ),
    # ── Sage (default — balanced professional) ────────────────────────────
    "sage": VoiceProfile(
        alias="sage",
        elevenlabs_id="onwK4e9ZLuTAKqWW03F9",
        gender="neutral",
        style="calm, measured, intelligent",
        best_for="default — works well for all report types",
    ),
}

DEFAULT_VOICE = "sage"
SKILL_VOICE_MAP: dict[str, str] = {
    "citation-audit": "rachel",
    "gbp-monitor": "drew",
    "keyword-hygiene": "josh",
    "falcon-report": "adam",
    "research": "elli",
}


class TTSClient:
    """
    ElevenLabs-backed TTS with pyttsx3 offline fallback.

    Instantiate once; the API key is read from ELEVENLABS_API_KEY in .env.
    """

    def __init__(self, api_key: str | None = None):
        self._key = api_key or os.getenv("ELEVENLABS_API_KEY", "")
        self._client = None
        if self._key:
            try:
                from elevenlabs.client import ElevenLabs
                self._client = ElevenLabs(api_key=self._key)
                logger.debug("tts_elevenlabs_ready")
            except Exception as exc:
                logger.warning("tts_elevenlabs_init_failed", exc=str(exc))

    @property
    def has_elevenlabs(self) -> bool:
        return self._client is not None

    # ── Public API ───────────────────────────────────────────────────────

    def speak(
        self,
        text: str,
        voice: str = DEFAULT_VOICE,
        model: str = "eleven_turbo_v2_5",
        play: bool = True,
        save_path: str | None = None,
    ) -> bytes | None:
        """
        Synthesize `text` and optionally play it.

        Returns raw MP3 bytes. If ElevenLabs is unavailable, falls back to
        pyttsx3 (plays only, no bytes returned).

        Args:
            text:      The text to speak. Long text is auto-chunked.
            voice:     Alias from VOICE_CATALOG or a raw ElevenLabs voice ID.
            model:     ElevenLabs model. eleven_turbo_v2_5 is fastest;
                       eleven_multilingual_v2 is highest quality.
            play:      If True, play audio immediately via system player.
            save_path: If set, also write the MP3 to this path.
        """
        text = _clean_for_speech(text)
        if not text.strip():
            return None

        if self._client:
            return self._speak_elevenlabs(text, voice, model, play, save_path)
        else:
            logger.info("tts_fallback_pyttsx3", reason="no ElevenLabs key")
            self._speak_pyttsx3(text)
            return None

    def voices(self) -> list[VoiceProfile]:
        """Return all voices in the catalog."""
        return list(VOICE_CATALOG.values())

    def voice_for_skill(self, skill_name: str) -> str:
        """Return the recommended voice alias for a given skill."""
        return SKILL_VOICE_MAP.get(skill_name, DEFAULT_VOICE)

    # ── ElevenLabs backend ───────────────────────────────────────────────

    def _speak_elevenlabs(
        self,
        text: str,
        voice: str,
        model: str,
        play: bool,
        save_path: str | None,
    ) -> bytes:
        from elevenlabs import VoiceSettings

        voice_id = _resolve_voice_id(voice)
        chunks = list(
            self._client.text_to_speech.convert(
                voice_id=voice_id,
                text=text,
                model_id=model,
                voice_settings=VoiceSettings(
                    stability=0.45,
                    similarity_boost=0.80,
                    style=0.20,
                    use_speaker_boost=True,
                ),
                output_format="mp3_44100_128",
            )
        )
        audio = b"".join(chunks)
        logger.info("tts_generated", voice=voice, chars=len(text), bytes=len(audio))

        if save_path:
            Path(save_path).write_bytes(audio)
            logger.info("tts_saved", path=save_path)

        if play:
            _play_audio(audio)

        return audio

    # ── Offline fallback ─────────────────────────────────────────────────

    def _speak_pyttsx3(self, text: str) -> None:
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.setProperty("rate", 165)
            engine.setProperty("volume", 0.9)
            voices = engine.getProperty("voices")
            if voices:
                engine.setProperty("voice", voices[0].id)
            engine.say(text)
            engine.runAndWait()
        except ImportError:
            logger.warning("tts_pyttsx3_not_installed", hint="pip install pyttsx3")
        except Exception as exc:
            logger.warning("tts_pyttsx3_failed", exc=str(exc))


# ── Module-level helpers ─────────────────────────────────────────────────────

_client: TTSClient | None = None


def _get_client() -> TTSClient:
    global _client
    if _client is None:
        _client = TTSClient()
    return _client


def speak(
    text: str,
    voice: str | None = None,
    skill: str | None = None,
    play: bool = True,
    save_path: str | None = None,
) -> bytes | None:
    """
    Module-level shortcut.

    voice: explicit alias or ID (overrides skill default)
    skill: skill name — auto-picks the best voice for that skill type
    """
    client = _get_client()
    resolved_voice = voice or (client.voice_for_skill(skill) if skill else DEFAULT_VOICE)
    return client.speak(text, voice=resolved_voice, play=play, save_path=save_path)


def list_voices() -> list[VoiceProfile]:
    return list(VOICE_CATALOG.values())


# ── Internal utilities ───────────────────────────────────────────────────────

def _resolve_voice_id(alias: str) -> str:
    """Map a catalog alias to an ElevenLabs voice ID. Pass-through raw IDs."""
    profile = VOICE_CATALOG.get(alias.lower())
    return profile.elevenlabs_id if profile else alias


def _clean_for_speech(text: str) -> str:
    """Strip Markdown syntax, table pipes, and code blocks before TTS."""
    import re
    # Remove fenced code blocks
    text = re.sub(r"```[\s\S]*?```", "", text)
    # Remove inline code
    text = re.sub(r"`[^`]+`", "", text)
    # Remove Markdown table rows (lines starting with |)
    text = re.sub(r"^\|.*\|$", "", text, flags=re.MULTILINE)
    # Remove heading hashes
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Convert bold/italic markers
    text = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", text)
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Trim
    return text.strip()


def _play_audio(audio_bytes: bytes) -> None:
    """Play MP3 bytes using the best available system player."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(audio_bytes)
        tmp = f.name
    try:
        # Try common players in order of preference
        for player in ("mpg123", "ffplay", "mpv", "afplay", "vlc"):
            result = subprocess.run(
                ["which", player], capture_output=True
            )
            if result.returncode == 0:
                subprocess.run(
                    [player, "-q", tmp] if player != "afplay" else [player, tmp],
                    capture_output=True,
                )
                return
        logger.warning("tts_no_player_found", hint="Install mpg123: apt install mpg123")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


# Keep Path import available
from pathlib import Path
