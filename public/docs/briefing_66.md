3월 26일 언데입니다..

금일 우리 시장 반도체업종에까지 영향을 미친 구글의 터보퀀트 관련, 글로벌 리서치하우스들의 의견을 간단히 정리해드립니다.

> 1.  **Goldman Sachs**
>     

*   “Memory efficiency shock → 단기 밸류에이션 리레이팅 압력”
    
*   TurboQuant는 AI inference 구조에서 메모리 수요 탄성 변화 유발
    
*   기존:→ “LLM = GPU + HBM scaling”
    
*   변화:→ “LLM = GPU 효율 + 압축 알고리즘”
    
*   핵심 논지: KV cache는 inference 메모리의 핵심 병목
    
*   여기를 6배 줄이면, GPU당 처리량 증가→ DRAM/SSD incremental demand 감소
    
*   그러나, “총 수요 감소” vs “AI 확산 가속” → 아직 불확실
    
*   Goldman 결론 톤: “단기적으로 memory multiple 저해요인나..중장기적으로는 AI 적용범위 가속화 공존”
    

> **2.  Morgan Stanley**

*   “과장된 공포 vs 구조적 수요 변화는 제한적”
    
*   핵심 논리 : TurboQuant는 inference optimization 기술, 그러나 training memory 수요 영향 없음, AI workload는 계속 증가
    
*   더 중요한 포인트 : 이미 시장은 int8 → int4 → quantization로 KV cache 최적화해왔고 상당 부분 반영된 상태
    
*   결론: 메모리 demand curve는 하향하는게 아니라 “효율화 후 재가속” 가능성
    

> **3.  Citi**

*   “Jevons Paradox 시나리오 (효율 → 수요 폭증)”
    
*   “제번스 역설: 기술이 발전하여 병목이 넓어지면 사용자가 급증한다는 역설. 쉽게 비유하면, 고속도로 차선 넓어지면 차가 증가한다는 비유”
    
*   논리 핵심: 비용 ↓ → AI deployment ↑
    
*   구조: 기존에 비용 높아서 제한된 추론만 가능했으나 추론비용이 낮아지면 사용사례가 증가할 것이라는 전망
    
*   실제 논쟁
    
    *   일부 분석: 메모리 수요 감소 우려
        
    *   반대 측: 수요 폭증 트리거 가능성
        
*   Citi 결론 : “We see this as demand-elasticity positive over time” (시간이 지날수록 수요 탄력성을 높이는 방향으로 작용할 것으로 본다)
    

> **4\. Bank of America**

*   “메모리 구조 변화 → NAND > DRAM 상대 수혜 가능성”
    
*   TurboQuant가 건드리는 건 DRAM (특히 KV cache) GPU 메모리
    
*   implication
    
*   DRAM 강도는 낮아지는 대신에 더 긴 context, 더 많은 inference(추론) → 스토리지(NAND) 수요  증가 가능성
    
*   연결 논리 (중요) KV cache 줄이면 더 많은 토큰 처리 → 데이터 저장/검색 증가
    
*   “Memory mix shift rather than memory collapse”  
    (메모리 수요가 무너지는 것이 아니라, 메모리 구성(구조)이 바뀌는 것이다)
    

> **5.  UBS** 

*   “기술적으로는 ‘거의 한계에 도달한 압축’ → upside 제한”
    
*   핵심 (가장 중요한 리서치 포인트) : TurboQuant는 information-theoretic limit (정보이론적 한계) 근접
    
*   의미 : 앞으로 더 큰 압축 혁신 나오기 어려움, 즉 “이게 끝판왕에 가까움”
    
*   UBS 해석 : 이미 업계에서는 일부 적용하고 있는 기술이고, TurboQuant는 마지막단계의 기술일 것으로 표현  
    (incremental improvement, 마지막 개선이라고 표현)
    
*   결론:  이미 시장은 이를 반영하고 있었다. 새로운 것 없었다는 톤
    
*   현재 시장은 2가지 시나리오 
    
    *   시나리오 A (약세론자): 메모리 필요량 줄어들 것이다 
        
    *   시나리오 B (Bull): 비용이 줄면  AI수요가 늘어날 것이다이고, 추론 트래픽이 증가할 것이다. 그럼 결국 메모리수요는 더욱 증가한다.
        

제가 지난해 초 딥시크 충격(적은 매개변수, 즉 적은 GPU로도 좋은 AI모델 만들 수 있다는)도 겪은터라, 이번 이슈는 전 그리 무섭지 않습니다.

도로가 넓어지면  차가 늘어날 것입니다.

* * *

오늘도 **개인투자자분이 3조원대의 순매수를 기록**했습니다.  
국가별로 가계자산의 구성비등을 살펴보겠습니다.

![](https://contents-resource.us-insight.com/dev/image/png/bc541225/1774527905376_bc541225__3.92982__ducJIoSHiIhwiAiHh3ByCCc?w=1080)

대략적인 수치입니다.  
조금은 다를수 있습니다만 표현하자면, 우리나라는 부동산, 미국은 주식,일본은 현금예금, 대만은 미국 다음으로 주식 비중이 높습니다.

총 인구수 대비 주식투자인구비율을 구해보면,  
한국은 30%, 미국은 60%, 일본은 20%, 대만은 50%수준의 비율을 보이고 있습니다.

금일도 대만 시장은 상대적인 강세를 이어가고 있습니다. 아시아 시장에서 TSMC가 시가총액 1위인 이유에 일정 부분 이런 요인들이 기여하고 있을지도 모르겠습니다.

공부 자료로 참고하시면 좋겠습니다.

* * *

쓰담쓰담