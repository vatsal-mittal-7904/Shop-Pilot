import subprocess
subprocess.run(["uv", "run", "--with", "graphifyy", "graphify", "extract", "--include", "src/backend/utils/rateLimit.ts", "src/app/api/chat/route.ts"])
