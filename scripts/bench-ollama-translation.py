import json
import time
import urllib.request

MODEL = "plamo3-translate-ja:latest"
TEXTS = [
    "The library opens at nine in the morning. Please return the books by Friday.",
    "The museum opens at ten in the morning. Please buy your tickets at the entrance.",
    "The train leaves at eight in the morning. Please arrive at the station on time.",
    "The office opens at nine in the morning. Please bring your documents on Monday.",
    "The garden opens at seven in the morning. Please keep the paths clean.",
    "The meeting starts at ten in the morning. Please read the report before Tuesday.",
]


def request(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    return urllib.request.urlopen(
        urllib.request.Request(
            "http://localhost:11434/api/" + path,
            data=data,
            headers={"Content-Type": "application/json"},
        ),
        timeout=180,
    )


print("before", request("ps").read().decode(), flush=True)
for i, text in enumerate(TEXTS + [TEXTS[-1]] * 5):
    prompt = (
        "<|plamo:tag|>dataset<|plamo:msg|>translation"
        "<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>"
        + text
        + "<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>"
    )
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "raw": True,
        "stream": True,
        "keep_alive": "5m",
        "options": {
            "num_ctx": 4096,
            "num_predict": 2048,
            "temperature": 0,
            "stop": ["<|plamo:tag|>", "<|plamo:bos|>"],
        },
    }
    start = time.perf_counter()
    first = None
    out = ""
    last = {}
    with request("generate", payload) as response:
        for line in response:
            row = json.loads(line)
            if "error" in row:
                raise RuntimeError(row["error"])
            if row.get("response"):
                if first is None:
                    first = time.perf_counter() - start
                out += row["response"]
            last = row
    elapsed = time.perf_counter() - start
    assert last.get("done") and last.get("done_reason") == "stop" and out.strip(), last
    assert any("\u3040" <= c <= "\u9fff" for c in out), out
    row = {
        "run": i + 1,
        "phase": "initial-load" if i == 0 else "warm-varied" if i < 6 else "warm-identical",
        "input": text,
        "output": out,
        "wall_s": elapsed,
        "ttft_s": first,
        **{
            k: v
            for k, v in last.items()
            if k.endswith(("duration", "count")) or k == "done_reason"
        },
    }
    print(json.dumps(row, ensure_ascii=False), flush=True)
print("after", request("ps").read().decode(), flush=True)
