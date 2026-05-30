"""工作流模板。"""

from __future__ import annotations

from pydantic import BaseModel

from aegisqa.skills.registry import SkillRegistry
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


class WorkflowTemplate(BaseModel):
    template_id: str
    name: str
    description: str
    scenario: str


class WorkflowTemplateService:
    """提供 ASR、RAG、Prompt 回归等快速创建模板。"""

    def __init__(self, registry: SkillRegistry) -> None:
        self.registry = registry

    def list_templates(self) -> list[WorkflowTemplate]:
        return [
            WorkflowTemplate(template_id="rag_regression", name="RAG 回归评测", description="LLMCall + LLMJudge", scenario="rag"),
            WorkflowTemplate(template_id="asr_eval", name="ASR 评测", description="ASREvalSkill", scenario="asr"),
            WorkflowTemplate(template_id="prompt_regression", name="Prompt 回归", description="LLMCall + Judge", scenario="prompt"),
        ]

    def create_workflow(self, template_id: str, name: str | None = None) -> WorkflowDraft:
        if template_id == "rag_regression":
            return WorkflowDraft(
                name=name or "rag_regression",
                steps=[
                    WorkflowStep(
                        step_id="answer",
                        skill_ref="llm.call@0.1.0",
                        input_mapping={"prompt": "row.question"},
                        output_mapping={"answer": "context.answer", "tokens": "metrics.tokens"},
                        config={"model": "demo-model", "temperature": 0},
                        cacheable=True,
                    ),
                    WorkflowStep(
                        step_id="judge",
                        skill_ref="llm.judge@0.1.0",
                        input_mapping={"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                        output_mapping={"score": "metrics.judge_score", "label": "context.judge_label", "reason": "context.judge_reason"},
                        config={"threshold": 0.6},
                    ),
                ],
            )
        if template_id == "asr_eval":
            return WorkflowDraft(
                name=name or "asr_eval",
                steps=[
                    WorkflowStep(
                        step_id="asr_eval",
                        skill_ref="asr.eval@0.1.0",
                        input_mapping={"audio_url": "row.audio_url", "reference_text": "row.reference_text"},
                        output_mapping={"cer": "metrics.cer", "wer": "metrics.wer", "pass": "context.asr_pass"},
                        config={"threshold": 0.2},
                    )
                ],
            )
        if template_id == "prompt_regression":
            return WorkflowDraft(
                name=name or "prompt_regression",
                steps=[
                    WorkflowStep(
                        step_id="answer",
                        skill_ref="llm.call@0.1.0",
                        input_mapping={"prompt": "row.prompt"},
                        output_mapping={"answer": "context.answer"},
                        config={"model": "demo-model", "temperature": 0},
                    ),
                    WorkflowStep(
                        step_id="judge",
                        skill_ref="llm.judge@0.1.0",
                        input_mapping={"question": "row.prompt", "answer": "context.answer", "reference": "row.expected_output"},
                        output_mapping={"score": "metrics.judge_score", "label": "context.judge_label"},
                        config={"threshold": 0.6},
                    ),
                ],
            )
        raise KeyError(f"未知模板：{template_id}")

