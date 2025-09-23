import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// 환경변수 로드
dotenv.config({ quiet: true });

// 버스 정류소 정보 타입 정의
interface BusStop {
  stId: string;
  stNm: string;
  tmX: string;
  tmY: string;
  arsId: string;
  posX: string;
  posY: string;
}

// 지하철역 정보 타입 정의
interface SubwayStation {
  subwayStationId: string;
  subwayStationName: string;
  subwayRouteName: string;
  x: string;
  y: string;
}

// 통합 대중교통 정보 타입
interface TransitStop {
  type: "bus" | "subway";
  id: string;
  name: string;
  x: string;
  y: string;
  additionalInfo?: string; // 버스: arsId, 지하철: 노선명
}

const SERVICE_KEY = "ENTER_YOUR_KEY";

// Create an MCP server
const server = new McpServer({
  name: "mcp-korea-public-transit-server",
  version: "1.0.0",
});

// 서울시 버스 정류소 위치 기반 검색 도구
server.registerTool(
  "get_bus_stops_by_location",
  {
    title: "서울시 버스 정류소 위치 검색",
    description:
      "위치(위도, 경도)를 기준으로 주변 버스 정류소 정보를 조회합니다",
    inputSchema: {
      tmX: z.number().describe("X좌표 (TM 좌표계)"),
      tmY: z.number().describe("Y좌표 (TM 좌표계)"),
      radius: z
        .number()
        .optional()
        .default(500)
        .describe("검색 반경 (미터, 기본값: 500)"),
    },
  },
  async ({ tmX, tmY, radius = 500 }) => {
    try {
      const url = new URL(
        "http://ws.bus.go.kr/api/rest/stationinfo/getStationByPos"
      );
      url.searchParams.append("serviceKey", SERVICE_KEY);
      url.searchParams.append("tmX", tmX.toString());
      url.searchParams.append("tmY", tmY.toString());
      url.searchParams.append("radius", radius.toString());
      url.searchParams.append("resultType", "json");

      const response = await fetch(url.toString());
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // JSON 응답을 파싱
      const busStops = parseApiResponse(responseText);

      return {
        content: [
          {
            type: "text",
            text: `검색 결과: ${busStops.length}개의 버스 정류소를 찾았습니다.\n\n${busStops
              .map(
                (stop: BusStop) =>
                  `• ${stop.stNm} (${stop.arsId})\n  위치: X=${stop.tmX}, Y=${stop.tmY}\n  정류소ID: ${stop.stId}`
              )
              .join("\n\n")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// 대중교통 통합 이름 검색
server.registerTool(
  "search_transit_stops_by_name",
  {
    title: "대중교통 정류소/역 이름 검색",
    description:
      "정류소명 또는 지하철역명을 기준으로 버스 정류소와 지하철역 정보를 통합 조회합니다",
    inputSchema: {
      searchTerm: z.string().describe("검색할 정류소명 또는 지하철역명"),
    },
  },
  async ({ searchTerm }) => {
    const results: TransitStop[] = [];

    try {
      // 버스 정류소와 지하철역을 동시에 검색
      const [busStops, subwayStations] = await Promise.all([
        searchBusStops(searchTerm).catch((error) => {
          return [];
        }),
        searchSubwayStations(searchTerm).catch((error) => {
          return [];
        }),
      ]);

      // 결과 합치기
      results.push(...busStops, ...subwayStations);

      return {
        content: [
          {
            type: "text",
            text: `"${searchTerm}" 검색 결과: 총 ${results.length}개의 대중교통 정류소/역을 찾았습니다.\n\n${results
              .map((stop) => {
                if (stop.type === "bus") {
                  return `🚌 ${stop.name} (${stop.additionalInfo})\n   위치: X=${stop.x}, Y=${stop.y}\n   정류소ID: ${stop.id}`;
                } else {
                  return `🚇 ${stop.name}\n   노선: ${stop.additionalInfo}\n   역ID: ${stop.id}`;
                }
              })
              .join("\n\n")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// API 응답을 파싱하는 함수 (JSON 형태로 응답받음)
function parseApiResponse(responseText: string): BusStop[] {
  const busStops: BusStop[] = [];

  try {
    const jsonResponse = JSON.parse(responseText);

    // 응답 구조: msgBody.itemList
    if (jsonResponse?.msgBody?.itemList) {
      const items = jsonResponse.msgBody.itemList; // itemList가 배열인지 단일 객체인지 확인
      const itemArray = Array.isArray(items) ? items : [items];

      itemArray.forEach((item: any) => {
        // API 응답의 실제 필드명 확인: stationId, stationNm (위치 검색) 또는 stId, stNm (이름 검색)
        const stationId = item.stationId || item.stId;
        const stationName = item.stationNm || item.stNm;

        if (stationId && stationName) {
          busStops.push({
            stId: stationId,
            stNm: stationName,
            tmX: item.tmX || item.gpsX || "",
            tmY: item.tmY || item.gpsY || "",
            arsId: item.arsId || "",
            posX: item.posX || "",
            posY: item.posY || "",
          });
        }
      });
    }
  } catch (error) {
    // JSON 파싱 실패 시 빈 배열 반환
  }

  return busStops;
}

// 버스 정류소 검색 헬퍼 함수
async function searchBusStops(searchTerm: string): Promise<TransitStop[]> {
  const url = new URL(
    "http://ws.bus.go.kr/api/rest/stationinfo/getStationByName"
  );
  url.searchParams.append("serviceKey", SERVICE_KEY);
  url.searchParams.append("stSrch", searchTerm);
  url.searchParams.append("resultType", "json");

  const response = await fetch(url.toString());
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const busStops = parseApiResponse(responseText);

  return busStops.map(
    (stop): TransitStop => ({
      type: "bus",
      id: stop.stId,
      name: stop.stNm,
      x: stop.tmX || stop.posX,
      y: stop.tmY || stop.posY,
      additionalInfo: stop.arsId,
    })
  );
}

// 지하철역 검색 헬퍼 함수
async function searchSubwayStations(
  searchTerm: string
): Promise<TransitStop[]> {
  const url = new URL(
    "http://apis.data.go.kr/1613000/SubwayInfoService/getKwrdFndSubwaySttnList"
  );
  url.searchParams.append("serviceKey", SERVICE_KEY);
  url.searchParams.append("numOfRows", "100");
  url.searchParams.append("_type", "json");
  url.searchParams.append("subwayStationName", searchTerm);

  const response = await fetch(url.toString());
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const subwayStations = parseSubwayApiResponse(responseText);

  return subwayStations.map(
    (station): TransitStop => ({
      type: "subway",
      id: station.subwayStationId,
      name: station.subwayStationName,
      x: station.x,
      y: station.y,
      additionalInfo: station.subwayRouteName,
    })
  );
}

// 지하철 API 응답을 파싱하는 함수
function parseSubwayApiResponse(responseText: string): SubwayStation[] {
  const subwayStations: SubwayStation[] = [];

  try {
    const jsonResponse = JSON.parse(responseText);

    // 지하철 API 응답 구조: response.body.items.item
    if (jsonResponse?.response?.body?.items?.item) {
      const items = jsonResponse.response.body.items.item;
      const itemArray = Array.isArray(items) ? items : [items];

      itemArray.forEach((item: any) => {
        if (item.subwayStationId && item.subwayStationName) {
          subwayStations.push({
            subwayStationId: item.subwayStationId,
            subwayStationName: item.subwayStationName,
            subwayRouteName: item.subwayRouteName || "",
            x: item.x || "",
            y: item.y || "",
          });
        }
      });
    }
  } catch (error) {
    // JSON 파싱 실패 시 빈 배열 반환
  }

  return subwayStations;
}

// 버스 정류소 정보 리소스
server.registerResource(
  "bus_station_info",
  new ResourceTemplate("bus_station://{stationId}", { list: undefined }),
  {
    title: "버스 정류소 정보",
    description: "정류소 ID로 상세 정보 조회",
  },
  async (uri, { stationId }) => ({
    contents: [
      {
        uri: uri.href,
        text: `정류소 ID: ${stationId}\n사용법: get_bus_stops_by_location 또는 search_bus_stops_by_name 도구를 사용하여 정류소 정보를 조회하세요.`,
      },
    ],
  })
);

// 지하철역 정보 리소스
server.registerResource(
  "subway_station_info",
  new ResourceTemplate("subway_station://{stationId}", { list: undefined }),
  {
    title: "지하철역 정보",
    description: "지하철역 ID로 상세 정보 조회",
  },
  async (uri, { stationId }) => ({
    contents: [
      {
        uri: uri.href,
        text: `지하철역 ID: ${stationId}\n사용법: search_transit_stops_by_name 도구를 사용하여 지하철역 정보를 조회하세요.`,
      },
    ],
  })
);

// 통합 대중교통 정보 리소스
server.registerResource(
  "transit_stop_info",
  new ResourceTemplate("transit://{type}/{stopId}", { list: undefined }),
  {
    title: "대중교통 정류소/역 정보",
    description: "버스 정류소 또는 지하철역의 통합 정보 조회",
  },
  async (uri, { type, stopId }) => {
    const stopType =
      type === "bus"
        ? "버스 정류소"
        : type === "subway"
          ? "지하철역"
          : "알 수 없는 교통수단";
    return {
      contents: [
        {
          uri: uri.href,
          text: `${stopType} ID: ${stopId}\n교통수단 타입: ${type}\n\n사용법:\n- get_bus_stops_by_location: 위치 기반 버스 정류소 검색\n- search_transit_stops_by_name: 이름 기반 대중교통 통합 검색`,
        },
      ],
    };
  }
);

const runServer = async () => {
  // 실행 모드 판단
  const isStdioMode =
    process.argv.includes("--stdio") ||
    process.env.MCP_MODE === "stdio" ||
    !process.env.PORT;

  if (isStdioMode) {
    // stdio 모드로 실행 (출력 제거)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // SSE 모드로 실행
  console.error("🌐 Starting MCP server in SSE mode...");
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const HOST = process.env.HOST || "localhost";

  // CORS 설정
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  app.use(express.json());

  // SSE 엔드포인트
  app.get("/sse", async (req, res) => {
    // stdio 모드가 아닐 때만 로그 출력
    if (!isStdioMode) {
      console.log("SSE connection established");
    }

    // SSE 헤더 설정
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    const transport = new SSEServerTransport("/message", res);

    await server.connect(transport);

    // 연결 종료 처리
    req.on("close", () => {
      // stdio 모드가 아닐 때만 로그 출력
      if (!isStdioMode) {
        console.log("SSE connection closed");
      }
    });
  });

  // 헬스 체크 엔드포인트
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      server: "mcp-korea-public-transit-server",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
  });

  // 정적 파일 제공 (선택사항)
  app.get("/", (req, res) => {
    res.send(`
      <html>
        <head>
          <title>Korea Public Transit MCP Server</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; }
            .endpoint { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #007bff; }
            .endpoint a { color: #007bff; text-decoration: none; font-weight: bold; }
            .endpoint a:hover { text-decoration: underline; }
            .info { color: #666; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚌 Korea Public Transit MCP Server</h1>
            <p>서울특별시 공공데이터포털의 정류소정보조회 API를 활용한 MCP 서버입니다.</p>
            
            <div class="endpoint">
              <strong>SSE Endpoint:</strong> <a href="/sse">/sse</a>
              <br><small>MCP 클라이언트 연결을 위한 Server-Sent Events 엔드포인트</small>
            </div>
            
            <div class="endpoint">
              <strong>Health Check:</strong> <a href="/health">/health</a>
              <br><small>서버 상태 확인</small>
            </div>
            
            <div class="info">
              <p><strong>서버 정보:</strong></p>
              <ul>
                <li>포트: ${PORT}</li>
                <li>호스트: ${HOST}</li>
                <li>버전: 1.0.0</li>
                <li>전송 방식: SSE (Server-Sent Events)</li>
              </ul>
              
              <p><strong>사용 가능한 도구:</strong></p>
              <ul>
                <li><code>get_bus_stops_by_location</code> - 위치 기반 정류소 검색</li>
                <li><code>search_bus_stops_by_name</code> - 이름 기반 정류소 검색</li>
              </ul>
            </div>
          </div>
        </body>
      </html>
    `);
  });

  app.listen(PORT, HOST, () => {
    console.log(`🚀 MCP Server running on http://${HOST}:${PORT}`);
    console.log(`📡 SSE endpoint: http://${HOST}:${PORT}/sse`);
    console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
    console.log(
      `🔑 Service Key: ${SERVICE_KEY ? "Configured" : "Not configured"}`
    );
  });
};

runServer().catch((error: any) => {
  // stdio 모드가 아닐 때만 에러 출력
  const isStdioMode =
    process.argv.includes("--stdio") ||
    process.env.MCP_MODE === "stdio" ||
    !process.env.PORT;

  if (!isStdioMode) {
    console.error(`Fatal error running server: ${error}`);
  }
  process.exit(1);
});
