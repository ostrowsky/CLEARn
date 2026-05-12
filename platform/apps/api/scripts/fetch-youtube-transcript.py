import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi


def main() -> int:
    if len(sys.argv) != 4:
        print(json.dumps({"text": "", "error": "Expected video_id start end arguments."}))
        return 2

    video_id = sys.argv[1]
    start_time = int(float(sys.argv[2]))
    end_time = int(float(sys.argv[3]))

    ytt_api = YouTubeTranscriptApi()
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
