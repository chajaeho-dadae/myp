"""
make_manifest.py  -  sword_images 폴더의 png 파일 목록으로 manifest.json 을 만들어 줍니다.

사용법
  1) index.html 과 같은 위치에 이 파일을 둡니다. (sword_images 폴더도 같은 위치)
  2) python make_manifest.py
  3) sword_images/manifest.json 이 생성/갱신됩니다. (이미지를 추가·변경할 때마다 다시 실행)

  ※ 다른 폴더를 쓰려면:  python make_manifest.py 폴더이름
"""
import json, os, re, sys

folder = sys.argv[1] if len(sys.argv) > 1 else "sword_images"
# 게임과 동일한 파일명 규칙:  A.[B.]C.png
rule = re.compile(r"^(\d+)\.(?:(\d+)\.)?(.+)\.png$", re.IGNORECASE)

if not os.path.isdir(folder):
    sys.exit(f"[오류] '{folder}' 폴더를 찾을 수 없습니다. index.html 과 같은 위치에서 실행하세요.")

good, skipped = [], []
for name in os.listdir(folder):
    if name.lower() == "manifest.json":
        continue                      # 목록 파일 자신은 제외
    if rule.match(name):
        good.append(name)
    else:
        skipped.append(name)

# 단계(A) 숫자 순으로 정렬
good.sort(key=lambda n: (int(rule.match(n).group(1)), n))

out = os.path.join(folder, "manifest.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(good, f, ensure_ascii=False, indent=2)

print(f"[완료] {out}  ({len(good)}개 파일)")
for n in good:
    print("  ", n)
if skipped:
    print(f"\n[무시됨] 규칙(A.[B.]C.png)에 맞지 않는 파일 {len(skipped)}개:")
    for n in skipped:
        print("  ", n)
