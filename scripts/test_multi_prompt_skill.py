"""测试多提示词类型 Skill"""
import requests
import json
import base64
import zipfile
import io
import time

BASE = 'http://localhost:8000'

print('='*60)
print('测试 3: 多提示词类型 Skill')
print('='*60)

# ===== 生成多提示词 Skill =====
print('\n[1/5] 生成多提示词 Skill Package...')

handler_code = '''"""多提示词类型 Skill。

使用多个 prompt 模板进行多维度分析：
1. 情感分析 prompt
2. 关键词提取 prompt
3. 摘要生成 prompt
"""


def run(inputs, config):
    """多维度文本分析。"""
    text = inputs.get("text", "")
    task = inputs.get("task", "多维度分析")

    # 获取多个 prompt 模板
    sentiment_prompt_tpl = config.get("sentiment_prompt", "分析以下文本的情感倾向：{text}")
    keyword_prompt_tpl = config.get("keyword_prompt", "提取以下文本的关键词：{text}")
    summary_prompt_tpl = config.get("summary_prompt", "生成以下文本的摘要：{text}")

    # 代码处理：分词
    words = list(text)
    word_count = len(words)

    # Prompt 1: 情感分析
    sentiment_prompt = sentiment_prompt_tpl.format(text=text)
    # 简单规则实现
    positive_chars = set("好棒优秀出色成功快乐喜欢美善")
    negative_chars = set("坏差失败糟糕难过讨厌丑恶")
    pos_count = sum(1 for c in text if c in positive_chars)
    neg_count = sum(1 for c in text if c in negative_chars)
    sentiment = "positive" if pos_count > neg_count else "negative" if neg_count > pos_count else "neutral"

    # Prompt 2: 关键词提取
    keyword_prompt = keyword_prompt_tpl.format(text=text)
    # 简单规则：提取2-4字的词组
    keywords = []
    for i in range(len(text)):
        for length in [4, 3, 2]:
            if i + length <= len(text):
                word = text[i:i+length]
                if word not in keywords and len(word) >= 2:
                    keywords.append(word)
    keywords = keywords[:5]

    # Prompt 3: 摘要生成
    summary_prompt = summary_prompt_tpl.format(text=text)
    summary = text[:50] + "..." if len(text) > 50 else text

    # 组装多维度结果
    result = {
        "task": task,
        "input_text": text,
        "dimensions": {
            "sentiment": {
                "prompt": sentiment_prompt,
                "result": sentiment,
                "confidence": abs(pos_count - neg_count) / max(word_count, 1),
            },
            "keywords": {
                "prompt": keyword_prompt,
                "result": keywords,
                "count": len(keywords),
            },
            "summary": {
                "prompt": summary_prompt,
                "result": summary,
                "length": len(summary),
            },
        },
        "prompts_used": [sentiment_prompt, keyword_prompt, summary_prompt],
        "total_prompts": 3,
        "conclusion": f"情感：{sentiment}，关键词：{', '.join(keywords[:3])}，摘要长度：{len(summary)}字",
    }

    return result
'''

skill_yaml = '''manifest_version: "1.0"
name: multi_prompt_analyzer
version: "1.0.0"
skill_id: plugin.multi_prompt_analyzer@1.0.0
description: 多提示词类型文本分析 Skill
runtime:
  language: python
  entrypoint: handler.py
input_schema:
  type: object
  properties:
    text:
      type: string
      description: 待分析文本
    task:
      type: string
      description: 分析任务
  required: [text]
output_schema:
  type: object
  properties:
    task:
      type: string
    input_text:
      type: string
    dimensions:
      type: object
    prompts_used:
      type: array
    total_prompts:
      type: integer
    conclusion:
      type: string
config_schema:
  type: object
  properties:
    sentiment_prompt:
      type: string
      description: 情感分析 prompt 模板
    keyword_prompt:
      type: string
      description: 关键词提取 prompt 模板
    summary_prompt:
      type: string
      description: 摘要生成 prompt 模板
permissions: []
example_input:
  text: 人工智能技术正在快速发展，为各行各业带来了巨大的变革和机遇
  task: 多维度分析
example_config:
  sentiment_prompt: "分析以下文本的情感倾向：{text}"
  keyword_prompt: "提取以下文本的关键词：{text}"
  summary_prompt: "生成以下文本的摘要：{text}"
'''

zip_buffer = io.BytesIO()
with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('handler.py', handler_code)
    zf.writestr('skill.yaml', skill_yaml)
zip_content = zip_buffer.getvalue()
print(f'  Package size: {len(zip_content)} bytes')

# ===== 上传 =====
print('\n[2/5] 上传 Skill...')
upload_resp = requests.post(f'{BASE}/skills/packages/upload', json={
    'filename': 'multi_prompt_analyzer.zip',
    'content_base64': base64.b64encode(zip_content).decode(),
})
print(f'  Status: {upload_resp.status_code}')
if upload_resp.status_code != 200:
    print(f'  Error: {upload_resp.text}')
    exit(1)
pkg = upload_resp.json()
skill_id = pkg['manifest']['skill_id']
print(f'  Skill ID: {skill_id}')

# ===== 合约测试 =====
print('\n[3/5] 合约测试...')
contract_resp = requests.post(f'{BASE}/skills/{skill_id}/contract-test', params={
    'role': 'Skill Developer',
    'actor': 'test_admin',
})
print(f'  Status: {contract_resp.status_code}')
if contract_resp.status_code == 200:
    ct = contract_resp.json()
    print(f'  OK: {ct.get("ok")}')
    if ct.get('ok'):
        print(f'  Latency: {ct.get("latency_ms")}ms')
    else:
        print(f'  Error: {ct.get("error")}')
        print(f'  Message: {ct.get("message", "")[:300]}')

# ===== 审批 =====
print('\n[4/5] 审批 Skill...')
approve_resp = requests.post(f'{BASE}/skills/{skill_id}/approve', json={
    'reason': 'Multi-prompt skill test',
    'actor': 'test_admin',
    'role': 'Admin',
})
print(f'  Status: {approve_resp.status_code}')
if approve_resp.status_code == 200:
    print(f'  Approved: {approve_resp.json().get("status")}')
else:
    print(f'  Error: {approve_resp.text[:200]}')

# ===== 创建 Workflow 并执行 =====
print('\n[5/5] 创建 Workflow 并执行...')

draft_resp = requests.post(f'{BASE}/workflow-drafts', json={
    'name': 'Multi-Prompt Test',
    'graph': {
        'name': 'Multi-Prompt Graph',
        'nodes': [
            {
                'node_id': 'analyze',
                'node_type': 'skill',
                'skill_ref': skill_id,
                'config': {
                    'sentiment_prompt': '分析以下文本的情感倾向：{text}',
                    'keyword_prompt': '提取以下文本的关键词：{text}',
                    'summary_prompt': '生成以下文本的摘要：{text}',
                },
                'input_mapping': {
                    'text': 'row.text',
                    'task': 'row.task',
                },
            }
        ],
        'edges': [],
    },
    'actor': 'test_admin',
    'role': 'Evaluator',
})
print(f'  Draft Status: {draft_resp.status_code}')
if draft_resp.status_code != 200:
    print(f'  Error: {draft_resp.text[:300]}')
    exit(1)
draft = draft_resp.json()
draft_id = draft.get('draft_id')

publish_resp = requests.post(f'{BASE}/workflow-drafts/{draft_id}/publish', json={
    'actor': 'test_admin',
    'role': 'Evaluator',
})
print(f'  Publish Status: {publish_resp.status_code}')
if publish_resp.status_code != 200:
    print(f'  Error: {publish_resp.text[:300]}')
    exit(1)
version_id = publish_resp.json().get('version_id')
print(f'  Version ID: {version_id}')

wf_resp = requests.get(f'{BASE}/workflows')
wfs = wf_resp.json()
target_wf = None
for wf in wfs:
    if wf.get('version_id') == version_id:
        target_wf = wf
        break

ds_resp = requests.post(f'{BASE}/datasets/source-materialize', json={
    'name': 'multi_prompt_ds',
    'rows': [
        {'text': '人工智能技术正在快速发展，为各行各业带来了巨大的变革和机遇', 'task': '多维度分析'},
        {'text': '这款产品质量很差，用户体验非常不好，强烈不推荐购买', 'task': '多维度分析'},
    ],
    'actor': 'test_admin',
    'role': 'Evaluator',
})
ds = ds_resp.json()
print(f'  Dataset: {ds["dataset_id"]} v{ds["version"]}')

run_resp = requests.post(f'{BASE}/runs', json={
    'workflow': target_wf,
    'dataset_id': ds['dataset_id'],
    'dataset_version': ds['version'],
    'actor': 'test_admin',
    'role': 'Evaluator',
})
print(f'  Run Status: {run_resp.status_code}')
if run_resp.status_code != 200:
    print(f'  Error: {run_resp.text[:300]}')
    exit(1)
run = run_resp.json()
run_id = run['run_id']
print(f'  Run ID: {run_id}')

exec_resp = requests.post(f'{BASE}/runs/{run_id}/execute')
print(f'  Execute Status: {exec_resp.status_code}')

print('\n  等待执行结果...')
for i in range(15):
    time.sleep(1)
    result_resp = requests.get(f'{BASE}/runs/{run_id}')
    result = result_resp.json()
    state = result.get('status')
    if state in ('succeeded', 'failed', 'completed'):
        print(f'  Final State: {state}')
        break

items = result.get('items', [])
print(f'  Total Items: {len(items)}')
for idx, item in enumerate(items):
    print(f'\n  --- Item {idx+1} ---')
    print(f'  Status: {item.get("status")}')
    steps = item.get('steps', [])
    if steps:
        step = steps[0]
        print(f'  Step Status: {step.get("status")}')
        output = step.get('output_snapshot')
        if output:
            print(f'  Conclusion: {output.get("conclusion")}')
            print(f'  Total Prompts Used: {output.get("total_prompts")}')
            dims = output.get("dimensions", {})
            print(f'  Sentiment: {dims.get("sentiment", {}).get("result")}')
            print(f'  Keywords: {dims.get("keywords", {}).get("result")}')
            print(f'  Summary: {dims.get("summary", {}).get("result", "")[:50]}...')
