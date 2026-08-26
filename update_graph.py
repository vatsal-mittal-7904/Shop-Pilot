import graphifyy
import os

# Create/Update the graph
graphifyy.extract(
    include=["src/backend/utils/rateLimit.ts", "src/app/api/chat/route.ts"],
    output_dir="graphify-out"
)
