"""Read the two JSON blobs dropped in /tmp and print the skew breakdown."""
import json

with open("/tmp/acc.json") as f:
    acc = json.load(f)
with open("/tmp/lb.json") as f:
    lb = json.load(f)

print("=== signal track by skew (fade thesis track record) ===")
for k, v in acc["by_skew"].items():
    print(f"  {k:15s}  {v['correct']:4d}/{v['total']:4d}  {v['win_rate']*100:5.1f}%")

print()
print("=== trader leaderboard (min_signals=30) ===")
for x in lb["traders"]:
    ci = x["ci"]
    addr = x["trader_address"][:10]
    print(
        f"  {addr}  acc={x['accuracy_pct']:5.1f}%  "
        f"CI=[{ci['lo']:.0f}-{ci['hi']:.0f}]  "
        f"n={x['total_divergent_signals']}"
    )
