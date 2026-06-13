import { ArrowRightOutlined, CheckCircleOutlined, CloseOutlined, DatabaseOutlined, ExperimentOutlined, FileDoneOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Button, Card, Modal, Space, Steps, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const { Title, Text, Paragraph } = Typography;

interface TutorialStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  link: string;
  linkText: string;
}

const tutorialSteps: TutorialStep[] = [
  {
    title: '上传数据',
    description: '首先上传您的评测数据集。支持 CSV 和 JSONL 格式，每行代表一个评测样本。',
    icon: <DatabaseOutlined />,
    link: '/datasets',
    linkText: '前往数据集页面',
  },
  {
    title: '选择 Skill',
    description: '从 Skill 市场选择评测所需的 Skill，或上传自定义 Skill 包。',
    icon: <ExperimentOutlined />,
    link: '/skills',
    linkText: '前往 Skill 市场',
  },
  {
    title: '创建 Workflow',
    description: '用可视化画布编排评测流程，连接多个 Skill 形成完整的评测链路。',
    icon: <PlayCircleOutlined />,
    link: '/workflows',
    linkText: '前往 Workflow 市场',
  },
  {
    title: '执行任务',
    description: '选择数据集和 Workflow，创建评测任务并执行。',
    icon: <PlayCircleOutlined />,
    link: '/runs',
    linkText: '前往执行中心',
  },
  {
    title: '查看报告',
    description: '任务完成后查看评测报告，分析通过率、Badcase 和诊断建议。',
    icon: <FileDoneOutlined />,
    link: '/reports',
    linkText: '前往报告中心',
  },
];

interface OnboardingTutorialProps {
  visible: boolean;
  onClose: () => void;
}

export function OnboardingTutorial({ visible, onClose }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const step = tutorialSteps[currentStep];

  return (
    <Modal
      title={
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
          <span>AegisQA 快速入门</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
      closeIcon={<CloseOutlined />}
    >
      <div style={{ marginBottom: 24 }}>
        <Steps
          current={currentStep}
          size="small"
          items={tutorialSteps.map((s) => ({ title: s.title }))}
        />
      </div>

      <Card
        style={{
          textAlign: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          border: 'none',
          color: 'white',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>{step.icon}</div>
        <Title level={4} style={{ color: 'white', marginBottom: 8 }}>
          {step.title}
        </Title>
        <Paragraph style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
          {step.description}
        </Paragraph>
        <Link to={step.link} onClick={onClose}>
          <Button type="primary" ghost icon={<ArrowRightOutlined />}>
            {step.linkText}
          </Button>
        </Link>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button onClick={handlePrev} disabled={currentStep === 0}>
          上一步
        </Button>
        <Text type="secondary">
          {currentStep + 1} / {tutorialSteps.length}
        </Text>
        <Button type="primary" onClick={handleNext}>
          {currentStep === tutorialSteps.length - 1 ? '完成' : '下一步'}
        </Button>
      </div>
    </Modal>
  );
}

export function useOnboarding() {
  const [showTutorial, setShowTutorial] = useState(() => {
    return !localStorage.getItem('aegisqa_onboarding_completed');
  });

  const completeOnboarding = () => {
    localStorage.setItem('aegisqa_onboarding_completed', 'true');
    setShowTutorial(false);
  };

  const resetOnboarding = () => {
    localStorage.removeItem('aegisqa_onboarding_completed');
    setShowTutorial(true);
  };

  return {
    showTutorial,
    completeOnboarding,
    resetOnboarding,
  };
}
