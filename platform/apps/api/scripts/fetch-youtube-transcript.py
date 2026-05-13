import json
import os
import sys

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig


def parse_locations(value: str):
    return [item.strip().upper() for item in value.split(",") if item.strip()]


def build_proxy_config():
    webshare_username = os.getenv("YOUTUBE_TRANSCRIPT_WEBSHARE_USERNAME", "").strip()
    webshare_password = os.getenv("YOUTUBE_TRANSCRIPT_WEBSHARE_PASSWORD", "").strip()
    if webshare_username and webshare_password:
        retries_raw = os.getenv("YOUTUBE_TRANSCRIPT_WEBSHARE_RETRIES", "").strip()
        retries_when_blocked = int(retries_raw) if retries_raw.isdigit() else 10
        domain_name = os.getenv("YOUTUBE_TRANSCRIPT_WEBSHARE_DOMAIN", "").strip() or "p.webshare.io"
        proxy_port_raw = os.getenv("YOUTUBE_TRANSCRIPT_WEBSHARE_PORT", "").strip()
        proxy_port = int(proxy_port_raw) if proxy_port_raw.isdigit() else 80
        locations = parse_locations(os.getenv("YOUTUBE_TRANSCRIPT_WEBSHARE_LOCATIONS", ""))
        return WebshareProxyConfig(
            proxy_username=webshare_username,
            proxy_password=webshare_password,
            filter_ip_locations=locations or None,
            retries_when_blocked=retries_when_blocked,
            domain_name=domain_name,
            proxy_port=proxy_port,
        )

    shared_proxy = os.getenv("YOUTUBE_TRANSCRIPT_PROXY_URL", "").strip()
    http_proxy = os.getenv("YOUTUBE_TRANSCRIPT_HTTP_PROXY", "").strip() or shared_proxy
    https_proxy = os.getenv("YOUTUBE_TRANSCRIPT_HTTPS_PROXY", "").strip() or shared_proxy
    if http_proxy or https_proxy:
        return GenericProxyConfig(http_url=http_proxy or None, https_url=https_proxy or None)

    return None


def main() -> int:
    if len(sys.argv) != 4:
        print(json.dumps({"text": "", "error": "Expected video_id start end arguments."}))
        return 2

    video_id = sys.argv[1]
    start_time = int(float(sys.argv[2]))
    end_time = int(float(sys.argv[3]))

    proxy_config = build_proxy_config()
    ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config) if proxy_config else YouTubeTranscriptApi()
    fetched_transcript = ytt_api.fetch(video_id, languages=["ru", "en"])
    transcript = fetched_transcript.to_raw_data()
    filtered = [
        item
        for item in transcript
        if start_time <= float(item.get("start", 0)) < end_time
    ]
    text = " ".join(str(item.get("text", "")).strip() for item in filtered).strip()
    print(json.dumps({"text": text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"text": "", "error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
