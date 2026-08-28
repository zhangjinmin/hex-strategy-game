
import os
from datetime import datetime

# 設定要排除的目錄與檔案後綴，避免合併無用資料或二進位檔案
EXCLUDE_DIRS = {'.git', 'node_modules', 'dist', 'build', 'assets', 'public', '__pycache__'}
EXCLUDE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.mp3', '.mp4', '.zip', '.exe', '.dll', '.pyc', '.woff', '.ttf', '.txt'}

def get_output_filename():
    """以當前時間生成輸出檔名，格式：YYYYMMDDHHMM.txt（例：202606241054.txt）"""
    return datetime.now().strftime('%Y%m%d%H%M') + '.txt'

def generate_tree(dir_path, exclude_name, prefix=""):
    tree_str = ""
    try:
        items = sorted(os.listdir(dir_path))
    except PermissionError:
        return ""

    # 過濾排除名單、輸出檔案本身、腳本自身
    items = [i for i in items
             if i not in EXCLUDE_DIRS
             and not i.endswith(tuple(EXCLUDE_EXTS))
             and i != exclude_name
             and i != os.path.basename(__file__)]

    for i, item in enumerate(items):
        path = os.path.join(dir_path, item)
        is_last = i == len(items) - 1
        connector = "└── " if is_last else "├── "
        tree_str += f"{prefix}{connector}{item}\n"
        if os.path.isdir(path):
            extension = "    " if is_last else "│   "
            tree_str += generate_tree(path, exclude_name, prefix + extension)
    return tree_str

def merge_code(base_dir):
    output_name = get_output_filename()
    output_path = os.path.join(base_dir, output_name)

    with open(output_path, 'w', encoding='utf-8') as outfile:
        # 1. 寫入清晰的目錄結構樹
        outfile.write("================ 目錄結構 ================\n")
        outfile.write(f"src/\n{generate_tree(base_dir, output_name)}\n\n")

        # 2. 遍歷並寫入檔案內容
        outfile.write("================ 程式碼內容 ================\n")
        for root, dirs, files in os.walk(base_dir):
            # 移除不需要遍歷的目錄，並排序確保輸出穩定
            dirs[:] = sorted([d for d in dirs if d not in EXCLUDE_DIRS])

            # 對檔案排序，確保每次輸出順序一致，方便 diff 比對
            for file in sorted(files):
                if (file == output_name
                    or file == os.path.basename(__file__)
                    or any(file.endswith(ext) for ext in EXCLUDE_EXTS)):
                    continue

                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, base_dir)

                # 檔案分隔符號
                outfile.write(f"\n\n// {'='*50}\n")
                outfile.write(f"// File: src/{rel_path.replace(os.sep, '/')}\n")
                outfile.write(f"// {'='*50}\n\n")

                # 讀取檔案內容並處理編碼問題
                try:
                    with open(file_path, 'r', encoding='utf-8') as infile:
                        outfile.write(infile.read())
                except Exception:
                    try:
                        with open(file_path, 'r', encoding='gbk') as infile:
                            outfile.write(infile.read())
                    except:
                        outfile.write(f"// [讀取檔案失敗：可能為二進位檔案或不支援的編碼格式]\n")

    print(f"合併完成，檔案已生成: {output_path}")

if __name__ == '__main__':
    current_dir = os.path.dirname(os.path.abspath(__file__))
    merge_code(current_dir)

