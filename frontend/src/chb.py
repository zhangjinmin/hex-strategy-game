import os
from datetime import datetime

# 設定要排除的目錄與檔案後綴
EXCLUDE_DIRS = {'.git', 'node_modules', 'dist', 'build', 'assets', 'public', '__pycache__'}
EXCLUDE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.mp3', '.mp4', '.zip', '.exe', '.dll', '.pyc', '.woff', '.ttf', '.txt'}

def generate_tree(dir_path, exclude_names, prefix=""):
    """生成目錄樹，支持排除多個檔案名"""
    tree_str = ""
    try:
        items = sorted(os.listdir(dir_path))
    except PermissionError:
        return ""

    items = [i for i in items
             if i not in EXCLUDE_DIRS
             and not i.endswith(tuple(EXCLUDE_EXTS))
             and i not in exclude_names
             and i != os.path.basename(__file__)]

    for i, item in enumerate(items):
        path = os.path.join(dir_path, item)
        is_last = i == len(items) - 1
        connector = "└── " if is_last else "├── "
        tree_str += f"{prefix}{connector}{item}\n"
        if os.path.isdir(path):
            extension = "    " if is_last else "│   "
            tree_str += generate_tree(path, exclude_names, prefix + extension)
    return tree_str

def merge_code(base_dir, split_count=3):
    """
    合併代碼並拆分為多個檔案
    :param base_dir: 基礎目錄
    :param split_count: 拆分的檔案數量，預設為 3
    """
    base_time = datetime.now().strftime('%Y%m%d%H%M')
    # 生成帶序號的輸出檔名列表，例如：202607011234_1.txt, 202607011234_2.txt
    output_names = [f"{base_time}_{i+1}.txt" for i in range(split_count)]

    # 1. 收集所有需要合併的檔案
    all_files = []
    for root, dirs, files in os.walk(base_dir):
        dirs[:] = sorted([d for d in dirs if d not in EXCLUDE_DIRS])
        for file in sorted(files):
            # 排除輸出檔案本身、腳本自身以及排除名單
            if file in output_names or file == os.path.basename(__file__):
                continue
            if any(file.endswith(ext) for ext in EXCLUDE_EXTS):
                continue
            all_files.append((root, file))

    # 2. 將檔案列表盡可能平均地分成 split_count 份
    def split_list(lst, n):
        k, m = divmod(len(lst), n)
        return [lst[i*k+min(i, m):(i+1)*k+min(i+1, m)] for i in range(n)]

    file_chunks = split_list(all_files, split_count)

    # 3. 生成統一的目錄樹
    tree_str = f"src/\n{generate_tree(base_dir, output_names)}\n\n"

    # 4. 遍歷每個分片，寫入對應的輸出檔案
    for i, chunk in enumerate(file_chunks):
        output_path = os.path.join(base_dir, output_names[i])
        
        with open(output_path, 'w', encoding='utf-8') as outfile:
            # 寫入目錄結構樹
            outfile.write("================ 目錄結構 ================\n")
            outfile.write(tree_str)
            
            # 寫入程式碼內容
            outfile.write("================ 程式碼內容 ================\n")
            
            for root, file in chunk:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, base_dir)

                outfile.write(f"\n\n// {'='*50}\n")
                outfile.write(f"// File: src/{rel_path.replace(os.sep, '/')}\n")
                outfile.write(f"// {'='*50}\n\n")

                try:
                    with open(file_path, 'r', encoding='utf-8') as infile:
                        outfile.write(infile.read())
                except Exception:
                    try:
                        with open(file_path, 'r', encoding='gbk') as infile:
                            outfile.write(infile.read())
                    except:
                        outfile.write(f"// [讀取檔案失敗：可能為二進位檔案或不支援的編碼格式]\n")

        print(f"分片 {i+1}/{split_count} 完成，已生成: {output_path}")

if __name__ == '__main__':
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # 可以修改 split_count 的值來控制拆分的檔案數量
    merge_code(current_dir, split_count=3)