import json
import re
import sys
from pathlib import Path


def normalize_text(value):
    value = re.sub(r"[\s\u3000]+", "", value.lower())
    return re.sub(r"[，。！？、；：()（）\[\]{}「」“”‘’]", "", value)


def fnv1a(value):
    result = 2166136261
    for char in value:
        result ^= ord(char)
        result = (result * 16777619) & 0xFFFFFFFF
    return f"{result:08x}"


def strip_list_marker(line):
    return re.sub(r"^(?:[-*]|•)\s*", "", line).strip()


def option_label(value):
    value = value.strip().upper()
    return chr(ord("A") + int(value) - 1) if value.isdigit() else value


def parse_option(line):
    clean = strip_list_marker(line)
    match = re.match(r"^([A-Ha-h]|[1-9])\s*[.．、)）:：-]\s*(.+)$", clean)
    if not match:
        return None
    return {"label": option_label(match.group(1)), "text": match.group(2).strip()}


def parse_answers(value, options):
    value = re.sub(r"^[\s•·、,，;；:：]+", "", value.strip())
    value = re.sub(r"^[（(【\[]\s*", "", value)
    if not value or value.startswith("未识别"):
        return []
    existing = {item["label"] for item in options}
    patterns = [
        r"^([A-Ha-h](?:\s*[,，、/及和&+]\s*[A-Ha-h])+)",
        r"^([A-Ha-h]{1,8})(?=\s*(?:[.．:：)）-]|$))",
        r"^([1-9](?:\s*[,，、/及和&+]\s*[1-9])+)",
        r"^([1-9]{1,8})(?=\s*(?:[.．:：)）-]|$))",
        r"^([A-Ha-h1-9]{1,8})(?=\s|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, value)
        if not match:
            continue
        answers = []
        for token in re.split(r"[\s,，、/及和&+]+", match.group(1).upper()):
            for char in token:
                label = option_label(char)
                if label in existing and label not in answers:
                    answers.append(label)
        if answers:
            return answers
    normalized = normalize_text(value)
    return [
        item["label"]
        for item in options
        if len(normalize_text(item["text"])) > 1 and normalize_text(item["text"]) in normalized
    ]


def parse_markdown(source):
    source = source.lstrip("\ufeff")
    source = re.sub(r"^---\s*\n[\s\S]*?\n---\s*\n", "", source, count=1)
    starts = list(re.finditer(r"^##\s+错题\s+\d+/\d+\s*$", source, re.MULTILINE))
    questions = []
    seen_ids = set()
    for position, match in enumerate(starts):
        next_start = starts[position + 1].start() if position + 1 < len(starts) else len(source)
        chunk = source[match.start():next_start]
        metadata = {}
        sections = {}
        current = None
        for raw_line in chunk.splitlines():
            heading = re.match(r"^###\s+(.+)$", raw_line.strip())
            if heading:
                current = heading.group(1).strip()
                sections[current] = []
            elif current is None:
                item = re.match(r"^-\s*([^：:]+)\s*[：:]\s*(.+)$", raw_line.strip())
                if item:
                    metadata[item.group(1).strip()] = item.group(2).strip()
            elif current:
                sections[current].append(raw_line)

        stem = "\n".join(line.strip() for line in sections.get("题干", []) if line.strip()).strip()
        options = []
        for raw_line in sections.get("选项", []):
            line = raw_line.strip()
            if not line:
                continue
            option = parse_option(line)
            if option:
                options.append(option)
            elif options:
                options[-1]["text"] = f'{options[-1]["text"]} {line}'.strip()

        answer_text = ""
        for raw_line in sections.get("答案", []):
            answer = re.match(
                r"^(?:答案|正确答案|正确选项)\s*[:：-]\s*(.+)$",
                strip_list_marker(raw_line.strip()),
                re.IGNORECASE,
            )
            if answer:
                answer_text = answer.group(1).strip()

        answers = parse_answers(answer_text, options)
        if not stem or len(options) < 2 or not answers:
            continue
        canonical = "|".join(
            [normalize_text(stem), *[f'{item["label"]}:{normalize_text(item["text"])}' for item in options]]
        )
        question_id = f"q-{fnv1a(canonical)}"
        if question_id in seen_ids:
            continue
        seen_ids.add(question_id)
        questions.append(
            {
                "stem": stem,
                "options": options,
                "correctAnswers": answers,
                "priority": metadata.get("优先级", "P2"),
                "domains": [
                    item.strip()
                    for item in re.split(r"\s+/\s+", metadata.get("知识域", "未分类"))
                    if item.strip()
                ],
                "questionType": metadata.get("题型", ""),
                "sourceNumber": metadata.get("题号", ""),
                "explanation": "\n".join(
                    line.strip() for line in sections.get("解析", []) if line.strip()
                ).strip(),
                "index": len(questions),
                "id": question_id,
            }
        )
    return questions


def main():
    if len(sys.argv) == 5 and sys.argv[3] == '--chunk-size':
        source_path = Path(sys.argv[1])
        output_path = Path(sys.argv[2])
        chunk_size = int(sys.argv[4])
        questions = parse_markdown(source_path.read_text(encoding='utf-8'))
        output_path.write_text('globalThis.KAOJJ_QUESTIONS = [];\n', encoding='utf-8')
        chunks = [
            questions[index:index + chunk_size]
            for index in range(0, len(questions), chunk_size)
        ]
        width = max(2, len(str(len(chunks))))
        for index, chunk in enumerate(chunks, start=1):
            filename = f'{output_path.stem}-{index:0{width}d}{output_path.suffix}'
            chunk_path = output_path.with_name(filename)
            payload = json.dumps(chunk, ensure_ascii=False, separators=(',', ':'))
            chunk_path.write_text(
                f'globalThis.KAOJJ_QUESTIONS.push(...{payload});\n',
                encoding='utf-8',
            )
        print(f'generated {len(questions)} questions in {len(chunks)} chunks')
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: python build_question_bank.py <source.md> <question-bank.js>")
    source_path, output_path = map(Path, sys.argv[1:])
    questions = parse_markdown(source_path.read_text(encoding="utf-8"))
    payload = json.dumps(questions, ensure_ascii=False, separators=(",", ":"))
    output_path.write_text(f"globalThis.KAOJJ_QUESTIONS = {payload};\n", encoding="utf-8")
    print(f"generated {len(questions)} questions -> {output_path}")


if __name__ == "__main__":
    main()
