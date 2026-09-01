import os

def count_lines(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            total = len(lines)
            code = 0
            blank = 0
            comment = 0
            in_multiline_comment = False
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    blank += 1
                elif filepath.endswith(('.ts', '.tsx', '.js', '.jsx', '.css')):
                    if in_multiline_comment:
                        comment += 1
                        if '*/' in stripped:
                            in_multiline_comment = False
                    elif stripped.startswith('/*'):
                        comment += 1
                        if '*/' not in stripped:
                            in_multiline_comment = True
                    elif stripped.startswith('//'):
                        comment += 1
                    else:
                        code += 1
                elif filepath.endswith('.prisma'):
                    if stripped.startswith('//'):
                        comment += 1
                    else:
                        code += 1
                else:
                    code += 1
            return total, code, blank, comment
    except:
        return 0, 0, 0, 0

exts = {'.ts', '.tsx', '.js', '.jsx', '.prisma', '.css'}
exclude_dirs = {'node_modules', '.next', '.git', 'playwright-report', 'test-results', '.vscode', 'tests'}

total_lines = 0
total_code = 0
total_blank = 0
total_comment = 0

stats = {}

for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in exclude_dirs]
    for file in files:
        if '.test.' in file or '.spec.' in file:
            continue
            
        ext = os.path.splitext(file)[1]
        if ext in exts:
            filepath = os.path.join(root, file)
            t, c, b, m = count_lines(filepath)
            total_lines += t
            total_code += c
            total_blank += b
            total_comment += m
            if ext not in stats:
                stats[ext] = {'files': 0, 'code': 0, 'blank': 0, 'comment': 0}
            stats[ext]['files'] += 1
            stats[ext]['code'] += c
            stats[ext]['blank'] += b
            stats[ext]['comment'] += m

print(f"{'Language':<15} {'files':>10} {'blank':>10} {'comment':>10} {'code':>10}")
print("-" * 60)
for ext, s in stats.items():
    print(f"{ext:<15} {s['files']:>10} {s['blank']:>10} {s['comment']:>10} {s['code']:>10}")
print("-" * 60)
print(f"{'SUM:':<15} {sum(s['files'] for s in stats.values()):>10} {total_blank:>10} {total_comment:>10} {total_code:>10}")
