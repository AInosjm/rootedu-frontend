'use client';

import { useState } from 'react';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import AIChat from '../../../components/ui/AIChat';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function CourseRecommendationPage() {
  type ChatMessage = {
    id: string;
    role: 'user' | 'ai';
    content: string;
    timestamp: Date;
  };

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'ai-welcome',
      role: 'ai',
      content: `안녕하세요! 강좌 추천 AI 어시스턴트입니다. 🎯

RootEdu의 인플루언서 강좌 중에서 당신에게 가장 적합한 강좌를 추천해드립니다.

**🎯 강좌 선택 가이드**

다음 질문들을 통해 최적의 강좌를 찾아보세요:

1. **현재 실력 수준은?** (초급/중급/고급)
2. **목표하는 성취 수준은?** (기초 다지기/실력 향상/고득점)
3. **선호하는 학습 방식은?** (이론 중심/실전 문제/토론형)
4. **가능한 학습 시간은?** (하루 30분/1시간/2시간 이상)
5. **특별히 보완하고 싶은 부분은?** (개념 이해/문제 풀이/시험 전략)

**📚 추천 가능한 과목 분야:**
- 수학 (기초/고급 수학, 미적분, 확률통계)
- 과학 (물리, 화학, 생명과학)
- 언어 (국어, 영어, 논술)
- 사회 (역사, 지리, 정치경제)
- 예체능 (음악, 미술, 체육)

어떤 과목이나 학습 목표에 대해 도움이 필요하신가요?`,
      timestamp: new Date(),
    },
  ]);

  const handleSendMessage = async (message: string) => {
    const now = Date.now();
    
    // 사용자 메시지 추가
    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);

    try {
      // OpenAI API 호출
      const response = await fetch('/api/tools/course-recommendation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          history: chatMessages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const aiMessage: ChatMessage = {
          id: `ai-${now + 1}`,
          role: 'ai',
          content: data.response,
          timestamp: new Date(),
        };
        setChatMessages(prev => [...prev, aiMessage]);
      } else {
        throw new Error('API 호출 실패');
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `ai-error-${now + 1}`,
        role: 'ai',
        content: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        timestamp: new Date(),
      };
      setChatMessages(prev => [...prev, errorMessage]);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/tools" 
            className="inline-flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            도구 목록으로 돌아가기
          </Link>
          <h1 className="text-3xl font-semibold text-[var(--color-text-primary)] mb-2">
            🎯 강좌 추천 AI 어시스턴트
          </h1>
          <p className="text-[var(--color-text-secondary)]">
            AI가 당신에게 맞는 최적의 인플루언서 강좌를 추천합니다
          </p>
        </div>

        {/* Chat Interface */}
        <Card className="p-6">
          <AIChat
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            placeholder="학습 목표나 선호사항을 알려주세요..."
            className="h-[600px]"
          />
        </Card>

        {/* Recommendation Tips */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            💡 효과적인 강좌 선택을 위한 팁
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h4 className="font-medium text-[var(--color-text-primary)] mb-2">🎯 목표 명확화</h4>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                "수학을 잘하고 싶다"보다는 "수학 모의고사 80점 이상"처럼 구체적으로
              </p>
            </Card>
            <Card className="p-4">
              <h4 className="font-medium text-[var(--color-text-primary)] mb-2">⏰ 시간 계획</h4>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                하루에 투자할 수 있는 시간을 정확히 파악하고 강좌 난이도에 맞추기
              </p>
            </Card>
            <Card className="p-4">
              <h4 className="font-medium text-[var(--color-text-primary)] mb-2">📊 학습 스타일</h4>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                이론 중심 vs 실전 중심, 혼자 vs 그룹 등 선호하는 학습 방식을 고려하기
              </p>
            </Card>
            <Card className="p-4">
              <h4 className="font-medium text-[var(--color-text-primary)] mb-2">🔄 단계별 접근</h4>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                기초부터 차근차근, 또는 현재 수준에서 한 단계 업그레이드하는 방향으로
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
