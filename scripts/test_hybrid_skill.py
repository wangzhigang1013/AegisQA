"""测试代码+提示词混合型 Skill"""
import requests
import json
import base64
import zipfile
import io
import time

BASE = 'http://localhost:8000'

print('='*60)
print('测试 2: 代码+提示词混合型 Skill')
print('='*60)

# ===== 生成代码+提示词混合 Skill =====
print('\n[1/5] 生成代码+提示词混合 Skill Package...')

handler_code = '''"""代码+提示词混合型 Skill。

代码部分：文本预处理、统计分析
提示词部分：通过 config 传入 prompt 模板，代码执行后组装结果
"""


def run(inputs, config):
    """分析文本并生成结构化报告。"""
    text = inputs.get("text", "")
    task = inputs.get("task", "分析文本")

    # 代码部分：文本预处理和统计
    words = text.split()
    word_count = len(words)
    char_count = len(text)
    sentence_count = text.count(".") + text.count("!") + text.count("?") + text.count("。") + text.count("！") + text.count("？")

    # 代码部分：提取关键词（简单实现）
    stop_words = {"的", "了", "是", "在", "和", "就", "都", "而", "及", "与", "the", "a", "an", "is", "are", "was", "were"}
    keywords = [w for w in words if len(w) > 1 and w.lower() not in stop_words][:5]

    # 代码部分：情感分析（基于关键词的简单规则）
    positive_words = {"好", "棒", "优秀", "出色", "成功", "快乐", "喜欢", "good", "great", "excellent", "wonderful", "amazing"}
    negative_words = {"坏", "差", "失败", "糟糕", "难过", "讨厌", "bad", "poor", "terrible", "awful", "horrible"}

    positive_count = sum(1 for w in words if w in positive_words)
    negative_count = sum(1 for w in words if w in negative_words)

    if positive_count > negative_count:
        sentiment = "positive"
    elif negative_count > positive_count:
        sentiment = "negative"
    else:
        sentiment = "neutral"

    # 提示词部分：从 config 获取 prompt 模板
    prompt_template = config.get("prompt_template", "请分析以下文本：{text}")
    prompt = prompt_template.format(text=text, task=task)

    # 代码部分：生成分析报告
    report = {
        "task": task,
        "input_text": text,
        "statistics": {
            "word_count": word_count,
            "char_count": char_count,
            "sentence_count": max(sentence_count, 1),
            "avg_word_length": round(sum(len(w) for w in words) / max(word_count, 1), 2),
        },
        "analysis": {
            "keywords": keywords,
            "sentiment": sentiment,
            "positive_signals": positive_count,
            "negative_signals": negative_count,
        },
        "prompt_used": prompt,
        "conclusion": f"文本包含 {word_count} 个词，情感倾向为 {sentiment}，关键词包括 {', '.join(keywords[:3])}。",
    }

    return report
'''

skill_yaml = '''manifest_version: "1.0"
name: text_analyzer_code_prompt
version: "1.0.0"
skill_id: plugin.text_analyzer_code_prompt@1.0.0
description: 代码+提示词混合型文本分析 Skill
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
    statistics:
      type: object
    analysis:
      type: object
    prompt_used:
      type: string
    conclusion:
      type: string
config_schema:
  type: object
  properties:
    prompt_template:
      type: string
      description: 提示词模板
permissions: []
example_input:
  text: 人工智能正在改变世界，让我们的生活更加便捷和美好
  task: 分析情感和关键词
example_config:
  prompt_template: "请分析以下文本的情感和关键词：{text}"
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
    'filename': 'text_analyzer_code_prompt.zip',
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
    'reason': 'Hybrid skill test',
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
    'name': 'Code+Prompt Hybrid Test',
    'graph': {
        'name': 'Hybrid Graph',
        'nodes': [
            {
                'node_id': 'analyze',
                'node_type': 'skill',
                'skill_ref': skill_id,
                'config': {
                    'prompt_template': '请分析以下文本的情感和关键词：{text}',
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
    'name': 'hybrid_test_ds',
    'rows': [
        {'text': '人工智能正在改变世界，让我们的生活更加便捷和美好', 'task': '分析情感和关键词'},
        {'text': '这个产品质量太差了，非常失望', 'task': '分析情感和关键词'},
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
            print(f'  Sentiment: {output.get("analysis", {}).get("sentiment")}')
            print(f'  Keywords: {output.get("analysis", {}).get("keywords")}')
            print(f'  Prompt Used: {output.get("prompt_used", "")[:80]}...')
