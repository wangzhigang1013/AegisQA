"""
测试所有 ASR 评测 Skills
"""

import sys
import os

# 添加 skills 目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wer_comparison.handler import run as wer_run
from timestamp_role_comparison.handler import run as timestamp_role_run
from text_role_comparison.handler import run as text_role_run


def test_wer_comparison():
    """测试字错率对比 Skill"""
    print("=" * 60)
    print("测试字错率对比 Skill")
    print("=" * 60)

    # 测试用例 1: 完全匹配
    result = wer_run(
        inputs={
            "reference": "理想L9是一款非常好的车",
            "hypothesis": "理想L9是一款非常好的车"
        },
        config={"enable_content_wer": True}
    )
    print(f"测试1 - 完全匹配:")
    print(f"  字准率: {result['output']['accuracy']}%")
    print(f"  字错率: {result['output']['wer']}%")
    print(f"  内容词WER: {result['output']['content_wer']}%")
    print(f"  字符召回: {result['output']['coverage']}%")
    print()

    # 测试用例 2: 有错误
    result = wer_run(
        inputs={
            "reference": "理想L9是一款非常好的车",
            "hypothesis": "理想L6是一款非常好的车"
        },
        config={"enable_content_wer": True}
    )
    print(f"测试2 - 有错误:")
    print(f"  字准率: {result['output']['accuracy']}%")
    print(f"  字错率: {result['output']['wer']}%")
    print(f"  内容词WER: {result['output']['content_wer']}%")
    print(f"  字符召回: {result['output']['coverage']}%")
    print()


def test_timestamp_role_comparison():
    """测试时间戳角色对比 Skill"""
    print("=" * 60)
    print("测试时间戳角色对比 Skill")
    print("=" * 60)

    # 测试用例 1: 完全匹配
    result = timestamp_role_run(
        inputs={
            "reference_segments": [
                {"start": 0, "end": 1000, "role": "销售1", "text": "你好"},
                {"start": 1000, "end": 2000, "role": "客户1", "text": "你好"}
            ],
            "hypothesis_segments": [
                {"start": 0, "end": 1000, "role": "销售1", "text": "你好"},
                {"start": 1000, "end": 2000, "role": "客户1", "text": "你好"}
            ]
        },
        config={"iou_threshold": 0.5}
    )
    print(f"测试1 - 完全匹配:")
    print(f"  角色准确率: {result['output']['role_accuracy']}%")
    print(f"  总话段数: {result['output']['total_segments']}")
    print(f"  匹配话段: {result['output']['matched_segments']}")
    print(f"  正确话段: {result['output']['correct_segments']}")
    print(f"  错误话段: {result['output']['wrong_segments']}")
    print(f"  平均IoU: {result['output']['avg_iou']}")
    print()

    # 测试用例 2: 角色错误
    result = timestamp_role_run(
        inputs={
            "reference_segments": [
                {"start": 0, "end": 1000, "role": "销售1", "text": "你好"},
                {"start": 1000, "end": 2000, "role": "客户1", "text": "你好"}
            ],
            "hypothesis_segments": [
                {"start": 0, "end": 1000, "role": "客户1", "text": "你好"},
                {"start": 1000, "end": 2000, "role": "销售1", "text": "你好"}
            ]
        },
        config={"iou_threshold": 0.5}
    )
    print(f"测试2 - 角色错误:")
    print(f"  角色准确率: {result['output']['role_accuracy']}%")
    print(f"  总话段数: {result['output']['total_segments']}")
    print(f"  匹配话段: {result['output']['matched_segments']}")
    print(f"  正确话段: {result['output']['correct_segments']}")
    print(f"  错误话段: {result['output']['wrong_segments']}")
    print(f"  平均IoU: {result['output']['avg_iou']}")
    if result['output']['wrong_cases']:
        print(f"  错误案例:")
        for case in result['output']['wrong_cases'][:2]:
            print(f"    [{case['hyp_start']},{case['hyp_end']}] "
                  f"HYP={case['hyp_role']} → REF={case['ref_role']} "
                  f"IoU={case['iou']}")
    print()


def test_text_role_comparison():
    """测试文本角色对比 Skill"""
    print("=" * 60)
    print("测试文本角色对比 Skill")
    print("=" * 60)

    # 测试用例 1: 完全匹配
    result = text_role_run(
        inputs={
            "reference_segments": [
                {"role": "销售1", "text": "您好，欢迎来到理想汽车"},
                {"role": "客户1", "text": "你好，我想看看L9"}
            ],
            "hypothesis_segments": [
                {"role": "销售1", "text": "您好，欢迎来到理想汽车"},
                {"role": "客户1", "text": "你好，我想看看L9"}
            ]
        },
        config={"similarity_threshold": 0.6}
    )
    print(f"测试1 - 完全匹配:")
    print(f"  角色准确率: {result['output']['role_accuracy']}%")
    print(f"  总话段数: {result['output']['total_segments']}")
    print(f"  匹配话段: {result['output']['matched_segments']}")
    print(f"  正确话段: {result['output']['correct_segments']}")
    print(f"  错误话段: {result['output']['wrong_segments']}")
    print(f"  平均相似度: {result['output']['avg_similarity']}")
    print()

    # 测试用例 2: 角色错误
    result = text_role_run(
        inputs={
            "reference_segments": [
                {"role": "销售1", "text": "您好，欢迎来到理想汽车"},
                {"role": "客户1", "text": "你好，我想看看L9"}
            ],
            "hypothesis_segments": [
                {"role": "客户1", "text": "您好，欢迎来到理想汽车"},
                {"role": "销售1", "text": "你好，我想看看L9"}
            ]
        },
        config={"similarity_threshold": 0.6}
    )
    print(f"测试2 - 角色错误:")
    print(f"  角色准确率: {result['output']['role_accuracy']}%")
    print(f"  总话段数: {result['output']['total_segments']}")
    print(f"  匹配话段: {result['output']['matched_segments']}")
    print(f"  正确话段: {result['output']['correct_segments']}")
    print(f"  错误话段: {result['output']['wrong_segments']}")
    print(f"  平均相似度: {result['output']['avg_similarity']}")
    if result['output']['wrong_cases']:
        print(f"  错误案例:")
        for case in result['output']['wrong_cases'][:2]:
            print(f"    HYP={case['hyp_role']}「{case['hyp_text']}」→ "
                  f"REF={case['ref_role']}「{case['ref_text']}」 "
                  f"相似度={case['similarity']}")
    print()

    # 测试用例 3: 部分匹配（文本相似）
    result = text_role_run(
        inputs={
            "reference_segments": [
                {"role": "销售1", "text": "您好，欢迎来到理想汽车"},
                {"role": "客户1", "text": "你好，我想看看L9"},
                {"role": "销售1", "text": "这款车是我们的旗舰SUV"}
            ],
            "hypothesis_segments": [
                {"role": "销售1", "text": "您好欢迎来到理想汽车"},
                {"role": "客户1", "text": "你好我想看看L9"}
            ]
        },
        config={"similarity_threshold": 0.6}
    )
    print(f"测试3 - 部分匹配（文本相似）:")
    print(f"  角色准确率: {result['output']['role_accuracy']}%")
    print(f"  总话段数: {result['output']['total_segments']}")
    print(f"  匹配话段: {result['output']['matched_segments']}")
    print(f"  正确话段: {result['output']['correct_segments']}")
    print(f"  错误话段: {result['output']['wrong_segments']}")
    print(f"  未匹配话段: {result['output']['unmatched_segments']}")
    print(f"  平均相似度: {result['output']['avg_similarity']}")
    print()


if __name__ == "__main__":
    test_wer_comparison()
    print("\n" + "=" * 60 + "\n")
    test_timestamp_role_comparison()
    print("\n" + "=" * 60 + "\n")
    test_text_role_comparison()
