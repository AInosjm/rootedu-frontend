import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getRedisClient } from '../../../../lib/redis';
import { ChromaClient } from 'chromadb';
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ChromaDB 클라이언트와 기본 임베딩 함수 초기화
const chromaClient = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000'
});

const embeddingFunction = new DefaultEmbeddingFunction();

// 코사인 유사도 계산 함수
function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function POST(request: NextRequest) {
  try {
    const { message, history } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: '메시지가 필요합니다.' },
        { status: 400 }
      );
    }

    // Redis에서 인플루언서 데이터 검색
    const redis = await getRedisClient();
    const influencerSlugs = await redis.sMembers('influencers');
    let allInfluencers: any[] = [];

    // 모든 인플루언서 데이터 수집
    for (const slug of influencerSlugs) {
      const data = await redis.hGetAll(`influencer:${slug}`);
      if (data && data.name) {
        const influencer = {
          id: data.id,
          slug: data.slug,
          name: data.name,
          username: data.Instagram || data.username || '',
          avatar: data.avatar,
          bio: data.bio,
          description: data.description,
          tags: data.tags ? JSON.parse(data.tags) : [],
          stats: data.stats ? JSON.parse(data.stats) : {}
        };
        allInfluencers.push(influencer);
      }
    }

    let relevantInfluencers: any[] = [];
    
    try {
      // ChromaDB 컬렉션 접근 또는 생성
      const collectionName = 'rootedu-influencers';
      let collection;
      
      try {
        collection = await chromaClient.getCollection({
          name: collectionName
        } as any);
        console.log(`✅ ChromaDB 컬렉션 '${collectionName}' 접근 성공`);
      } catch {
        // 컬렉션이 없으면 생성 (기본 임베딩 함수 사용)
        collection = await chromaClient.createCollection({
          name: collectionName,
          embeddingFunction: embeddingFunction
        } as any);
        console.log(`✅ ChromaDB 컬렉션 '${collectionName}' 생성 성공 (기본 임베딩)`);
      }
      
      // 벡터 기반 의미적 검색 (RAG)
      try {
        console.log('🔍 벡터 기반 유사도 검색 시작...');
        
        // 검색 쿼리를 벡터로 변환
        const queryEmbedding = await embeddingFunction.generate(message as any);
        console.log('✅ 검색 쿼리 벡터화 완료');
        
        // 모든 인플루언서의 텍스트를 벡터로 변환
        console.log('🔄 인플루언서 텍스트 벡터화 중...');
        const influencerEmbeddings = await Promise.all(
          allInfluencers.map(async (inf, index) => {
            const searchableText = [
              inf.name,
              inf.username,
              inf.bio,
              inf.description,
              ...inf.tags
            ].join(' ');
            
            const embedding = await embeddingFunction.generate(searchableText as any);
            console.log(`✅ ${inf.name} 벡터화 완료 (${index + 1}/${allInfluencers.length})`);
            
            return { influencer: inf, embedding };
          })
        );
        
        // 코사인 유사도 점수 계산
        console.log('📊 유사도 점수 계산 중...');
        
        // 디버깅: 벡터 정보 확인
        console.log('🔍 디버깅: 쿼리 벡터 타입:', typeof queryEmbedding);
        console.log('🔍 디버깅: 쿼리 벡터 길이:', Array.isArray(queryEmbedding) ? queryEmbedding.length : 'N/A');
        
        const scoredInfluencers = influencerEmbeddings.map(({ influencer, embedding }, index) => {
          // 벡터 타입 처리 및 차원 정규화 (안전한 타입 변환)
          let queryVector = queryEmbedding as unknown as number[];
          let embeddingVector = embedding as unknown as number[];
          
          // 2차원 배열인 경우 첫 번째 요소 사용
          if (Array.isArray(queryVector[0])) {
            queryVector = queryVector[0] as unknown as number[];
          }
          if (Array.isArray(embeddingVector[0])) {
            embeddingVector = embeddingVector[0] as unknown as number[];
          }
          
          // 벡터 길이 맞추기 (짧은 쪽에 맞춤)
          const minLength = Math.min(queryVector.length, embeddingVector.length);
          const normalizedQuery = queryVector.slice(0, minLength);
          const normalizedEmbedding = embeddingVector.slice(0, minLength);
          
          const similarity = calculateCosineSimilarity(normalizedQuery, normalizedEmbedding);
          
          // 디버깅: 첫 번째 몇 개의 유사도 점수 확인
          if (index < 3) {
            console.log(`🔍 ${influencer.name} 유사도 점수:`, similarity);
            console.log(`🔍 ${influencer.name} 벡터 차원:`, normalizedEmbedding.length);
          }
          
          // NaN 체크 및 기본값 설정
          const validSimilarity = isNaN(similarity) ? 0.1 : Math.max(similarity, 0.1);
          
          return { ...influencer, similarityScore: validSimilarity };
        });
        
        // 유사도 점수로 정렬 (높은 점수 순)
        scoredInfluencers.sort((a, b) => b.similarityScore - a.similarityScore);
        
        // 모든 인플루언서 포함 (필터링 제거)
        relevantInfluencers = scoredInfluencers.map(inf => {
          if(inf.similarityScore > 0) {
            const { similarityScore, ...influencer } = inf;
            return influencer;
          }
        });
        
        console.log('✅ 벡터 기반 검색 성공:', relevantInfluencers.length, '개 결과');
        console.log('📈 최고 유사도 점수:', scoredInfluencers[0]?.similarityScore?.toFixed(4));
        console.log('📉 최저 유사도 점수:', scoredInfluencers[scoredInfluencers.length - 1]?.similarityScore?.toFixed(4));
        
      } catch (vectorError) {
        console.log('⚠️ 벡터 검색 실패, 키워드 기반 검색으로 대체:', vectorError);
        
        // 키워드 기반 검색으로 폴백
        const searchTerms = message.toLowerCase().split(' ');
        
        relevantInfluencers = allInfluencers.filter(inf => {
          const searchableText = [
            inf.name,
            inf.username,
            inf.bio,
            inf.description,
            ...inf.tags
          ].join(' ').toLowerCase();
          
          const matchScore = searchTerms.reduce((score: number, term: string) => {
            if (searchableText.includes(term)) {
              score += 1;
              if (inf.tags.some((tag: string) => tag.toLowerCase().includes(term))) {
                score += 2;
              }
            }
            return score;
          }, 0);
          
          return matchScore > 0;
        });
        
        // 관련성 점수로 정렬
        relevantInfluencers.sort((a, b) => {
          const aScore = searchTerms.reduce((score: number, term: string) => {
            const searchableText = [a.name, a.bio, a.description, ...a.tags].join(' ').toLowerCase();
            if (searchableText.includes(term)) score += 1;
            if (a.tags.some((tag: string) => tag.toLowerCase().includes(term))) score += 2;
            return score;
          }, 0);
          
          const bScore = searchTerms.reduce((score: number, term: string) => {
            const searchableText = [b.name, b.bio, b.description, ...b.tags].join(' ').toLowerCase();
            if (searchableText.includes(term)) score += 1;
            if (b.tags.some((tag: string) => tag.toLowerCase().includes(term))) score += 2;
            return score;
          }, 0);
          
          return bScore - aScore;
        });
        
        console.log('✅ 키워드 기반 검색 성공:', relevantInfluencers.length, '개 결과');
      }
      
    } catch (searchError) {
      console.error('❌ 검색 중 오류 발생:', searchError);
      // 검색 실패 시 모든 인플루언서를 반환
      relevantInfluencers = allInfluencers;
    }

    // 상위 5개 인플루언서 선택
    const topInfluencers = relevantInfluencers.slice(0, 5);

    // RAG를 위한 컨텍스트 구성
    const context = topInfluencers.map(inf => `
인플루언서: ${inf.name} (@${inf.username})
소개: ${inf.bio}
상세 설명: ${inf.description}
전문 분야: ${inf.tags.join(', ')}
팔로워: ${inf.stats.followers?.toLocaleString() || 0}명
무료 강좌: ${inf.stats.free_courses || 0}개
유료 강좌: ${inf.stats.paid_courses || 0}개
`).join('\n\n');

    // 대화 히스토리 구성 - OpenAI API 형식에 맞게 role 변환
    const messages = [
      {
        role: 'system' as const,
        content: `당신은 RootEdu 강좌 추천 전문 AI 어시스턴트입니다. 벡터 기반 의미적 검색과 키워드 검색을 통해 찾은 실제 인플루언서 데이터를 기반으로 학생들에게 최적의 강좌를 추천해야 합니다.

현재 RootEdu에 등록된 인플루언서 정보:
${context}

추천 기준:
- 현재 실력 수준 (초급/중급/고급)
- 목표 성취 수준 (기초/실력향상/고득점/특별활동)
- 선호하는 학습 방식 (이론중심/실전문제/토론형/프로젝트형)
- 가능한 학습 시간 (30분/1시간/2시간 이상)
- 특별히 보완하고 싶은 부분 (개념이해/문제풀이/시험전략/실습)

응답 스타일:
- 친근하고 격려적인 톤 사용
- 실제 존재하는 인플루언서만 추천
- 각 인플루언서의 특징과 장점을 구체적으로 설명
- 학생의 동기부여와 성공 가능성 강조
- 이모지를 활용한 가독성 있는 응답
- 한국어로 응답

주의사항:
- 위에 제공된 인플루언서 데이터만 사용하여 추천
- 존재하지 않는 인플루언서는 언급하지 않음
- 학생의 수준과 목표에 맞는 구체적인 추천
- 학습 동기와 지속성을 고려한 추천

항상 학생의 성공과 만족을 최우선으로 하여 최적의 인플루언서를 추천하세요.`
      },
      ...history.map((msg: any) => ({
        role: msg.role === 'ai' ? 'assistant' : msg.role,
        content: msg.content
      })),
      {
        role: 'user' as const,
        content: message
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      max_tokens: 1500,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || '죄송합니다. 응답을 생성할 수 없습니다.';

    return NextResponse.json({ response });

  } catch (error) {
    console.error('OpenAI API 오류:', error);
    return NextResponse.json(
      { error: 'AI 응답 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
