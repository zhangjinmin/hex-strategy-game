import os
from datetime import datetime

# 排除的目錄
EXCLUDE_DIRS = {'.git', 'node_modules', 'dist', 'build', 'assets', 'public', '__pycache__'}
# 只導出 .vue 和 .ts
ALLOWED_EXTS = {'.vue', '.ts'}

def get_unique_filename(directory, filename):
    """處理同名檔案衝突，自動添加序號（如 main.ts.txt, main_2.ts.txt）"""
    base, ext = os.path.splitext(filename)
    counter = 1
    new_filename = filename
    while os.path.exists(os.path.join(directory, new_filename)):
        counter += 1
        new_filename = f"{base}_{counter}{ext}"
    return new_filename

def export_code_files(base_dir, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    count = 0

    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        
        for file in files:
            # 1. 只處理 .vue 和 .ts
            if not any(file.endswith(ext) for ext in ALLOWED_EXTS):
                continue

            src_path = os.path.join(root, file)
            # 計算相對路徑並統一斜線
            rel_path = os.path.relpath(src_path, base_dir).replace(os.sep, '/')
            
            # 確保路徑以 src/ 開頭
            if not rel_path.startswith('src/'):
                rel_path = 'src/' + rel_path
                
            dir_structure = os.path.dirname(rel_path) + '/'

            # 2. 構建頭部目錄結構信息
            header = (
                f"// 文件路徑: {rel_path}\n"
                f"// 目錄結構: {dir_structure}\n"
                f"// {'='*50}\n\n"
            )

            # 讀取代碼內容
            try:
                with open(src_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except UnicodeDecodeError:
                try:
                    with open(src_path, 'r', encoding='gbk') as f:
                        content = f.read()
                except Exception:
                    continue

            # 3. 生成目標檔案名：原檔名 + .txt (例如 main.ts -> main.ts.txt)
            target_name = file + '.txt'
            target_name = get_unique_filename(output_dir, target_name) # 防重名
            target_path = os.path.join(output_dir, target_name)

            # 寫入檔案
            with open(target_path, 'w', encoding='utf-8') as f:
                f.write(header + content)
                
            count += 1
            print(f"已導出: {target_name} <- {rel_path}")

    print(f"\n✅ 完成！共導出 {count} 個檔案至: {output_dir}")

if __name__ == '__main__':
    current_dir = os.path.dirname(os.path.abspath(__file__))
    output_folder = f"export_{datetime.now().strftime('%Y%m%d%H%M')}"
    
    export_code_files(current_dir, output_folder)