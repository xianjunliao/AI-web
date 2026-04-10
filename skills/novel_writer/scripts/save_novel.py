import json
import os
import sys


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def append_unique_index(index_path: str, title: str, filename: str) -> bool:
    line = f"- [{title}](chapters/{filename})\n"

    if not os.path.exists(index_path):
        with open(index_path, "w", encoding="utf-8") as file:
            file.write("# 章节索引\n\n")
            file.write(line)
        return True

    with open(index_path, "r", encoding="utf-8") as file:
        existing = file.read()

    if line in existing:
        return False

    with open(index_path, "a", encoding="utf-8") as file:
        file.write(line)

    return True


def append_memory(memory_path: str, memory_update: str) -> bool:
    if not memory_update.strip():
        return False

    if not os.path.exists(memory_path):
        with open(memory_path, "w", encoding="utf-8") as file:
            file.write("# 小说记忆\n\n")

    with open(memory_path, "a", encoding="utf-8") as file:
        file.write("\n")
        file.write(memory_update.strip())
        file.write("\n")

    return True


def save_markdown(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as file:
        file.write(content.strip() + "\n")


def normalize_filename(filename: str) -> str:
    safe_name = os.path.basename(filename.strip())
    if not safe_name:
        raise ValueError("filename cannot be empty")
    if not safe_name.endswith(".md"):
        safe_name += ".md"
    return safe_name


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python save_novel.py <project_root> <json_file>")
        sys.exit(1)

    project_root = sys.argv[1]
    json_path = sys.argv[2]

    with open(json_path, "r", encoding="utf-8") as file:
        data = json.load(file)

    required_fields = ["filename", "title", "summary", "content", "memory_update"]
    missing = [key for key in required_fields if key not in data]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")

    filename = normalize_filename(data["filename"])
    title = data["title"].strip()
    content = data["content"].strip()
    summary = str(data.get("summary", "")).strip()
    memory_update = str(data.get("memory_update", "")).strip()

    if not title:
        raise ValueError("title cannot be empty")
    if not content:
        raise ValueError("content cannot be empty")
    if not summary:
        raise ValueError("summary cannot be empty")

    first_line = content.splitlines()[0].strip() if content.splitlines() else ""
    if first_line.startswith("#"):
        raise ValueError(
            "content 必须是正文内容本体，不能是 Markdown 标题。章节标题请放在 title 字段中。"
        )

    novel_dir = os.path.join(project_root, "novel")
    chapters_dir = os.path.join(novel_dir, "chapters")
    memory_dir = os.path.join(project_root, "memory")

    ensure_dir(novel_dir)
    ensure_dir(chapters_dir)
    ensure_dir(memory_dir)

    chapter_path = os.path.join(chapters_dir, filename)
    index_path = os.path.join(novel_dir, "chapters_index.md")
    memory_path = os.path.join(memory_dir, "novel_memory.md")

    save_markdown(chapter_path, content)
    index_updated = append_unique_index(index_path, title, filename)
    memory_updated = append_memory(memory_path, memory_update)

    result = {
        "saved": True,
        "chapter_path": chapter_path,
        "index_updated": index_updated,
        "memory_updated": memory_updated,
        "index_path": index_path,
        "memory_path": memory_path,
        "summary_present": bool(summary),
    }

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
