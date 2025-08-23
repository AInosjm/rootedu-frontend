import { getRedisClient } from '../lib/redis';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config({ path: '.env.local' });

async function setupVectorDB() {
  try {
    // 환경 변수 체크
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
      console.log('📝 .env.local 파일에 OPENAI_API_KEY를 설정해주세요.');
      console.log('💡 예시: OPENAI_API_KEY=sk-...');
      return;
    }

    console.log('✅ OpenAI API 키 확인됨');
    console.log('🔍 Redis에서 인플루언서 데이터 수집 중...');
    
    // Redis 연결
    const redis = await getRedisClient();
    const influencerSlugs = await redis.sMembers('influencers');
    
    if (influencerSlugs.length === 0) {
      console.log('❌ Redis에 인플루언서 데이터가 없습니다.');
      console.log('💡 먼저 npm run seed를 실행하여 데이터를 생성해주세요.');
      return;
    }
    
    console.log(`📊 총 ${influencerSlugs.length}명의 인플루언서 데이터 발견`);
    
    // ChromaDB 및 OpenAI 임베딩 초기화
    const { ChromaClient } = require('chromadb');
    const OpenAI = require('openai');
    
    // OpenAI 클라이언트 초기화
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // OpenAI Embedding 함수
    async function generateEmbedding(text: string) {
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        });
        
        return response.data[0].embedding;
      } catch (error) {
        console.error('OpenAI Embedding 오류:', error);
        throw error;
      }
    }
    
    // ChromaDB 클라이언트 초기화 (로컬 또는 원격)
    const chromaClient = new ChromaClient({
      path: process.env.CHROMA_URL || 'http://localhost:8000'
    });
    
    // ChromaDB 컬렉션 생성 또는 접근
    const collectionName = 'rootedu-influencers';
    let collection;
    
    try {
      collection = await chromaClient.getCollection({
        name: collectionName
      });
      console.log(`✅ ChromaDB 컬렉션 '${collectionName}' 접근 성공`);
    } catch {
      // 컬렉션이 없으면 생성
      collection = await chromaClient.createCollection({
        name: collectionName
      });
      console.log(`✅ ChromaDB 컬렉션 '${collectionName}' 생성 성공`);
    }
    
    // 기존 데이터 삭제 (선택사항)
    console.log('🗑️ 기존 벡터 데이터 삭제 중...');
    try {
      await collection.delete({ where: {} });
    } catch (error) {
      console.log('기존 데이터가 없거나 삭제 실패:', error);
    }
    
    // 인플루언서 데이터를 벡터로 변환하여 저장
    const vectors = [];
    const metadatas = [];
    const ids = [];
    
    for (const slug of influencerSlugs) {
      const data = await redis.hGetAll(`influencer:${slug}`);
      if (data && data.name) {
        // 검색 가능한 텍스트 구성
        const searchableText = [
          data.name,
          data.Instagram || data.username || '',
          data.bio,
          data.description,
          data.tags ? JSON.parse(data.tags).join(' ') : ''
        ].join(' ');
        
        // OpenAI로 텍스트를 벡터로 변환
        const embedding = await generateEmbedding(searchableText);
        
        vectors.push(embedding);
        metadatas.push({
          slug: data.slug,
          name: data.name,
          username: data.Instagram || data.username || '',
          bio: data.bio,
          description: data.description,
          tags: data.tags || '[]',
          stats: data.stats || '{}'
        });
        ids.push(data.id);
        
        console.log(`✅ ${data.name} 벡터 생성 완료`);
      }
    }
    
    if (vectors.length > 0) {
      // 새로운 벡터 데이터 저장
      console.log(`💾 ${vectors.length}개의 벡터를 ChromaDB에 저장 중...`);
      await collection.add({
        ids: ids,
        embeddings: vectors,
        metadatas: metadatas
      });
      
      console.log('🎉 ChromaDB 설정 완료!');
      console.log(`📊 총 ${vectors.length}명의 인플루언서가 벡터DB에 저장되었습니다.`);
    }
    
  } catch (error) {
    console.error('❌ ChromaDB 설정 중 오류 발생:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  setupVectorDB().then(() => {
    console.log('ChromaDB 설정 스크립트 완료');
    process.exit(0);
  }).catch((error) => {
    console.error('스크립트 실행 실패:', error);
    process.exit(1);
  });
}

export { setupVectorDB };
