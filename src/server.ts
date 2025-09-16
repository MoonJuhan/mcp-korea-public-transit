import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// 환경변수 로드
dotenv.config();

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

// 서울시 버스 정류소 이름 검색 도구
server.registerTool(
  "search_bus_stops_by_name",
  {
    title: "서울시 버스 정류소 이름 검색",
    description: "정류소명을 기준으로 버스 정류소 정보를 조회합니다",
    inputSchema: {
      stSrch: z.string().describe("검색할 정류소명"),
    },
  },
  async ({ stSrch }) => {
    try {
      const url = new URL(
        "http://ws.bus.go.kr/api/rest/stationinfo/getStationByName"
      );
      url.searchParams.append("serviceKey", SERVICE_KEY);
      url.searchParams.append("stSrch", stSrch);
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
            text: `"${stSrch}" 검색 결과: ${busStops.length}개의 버스 정류소를 찾았습니다.\n\n${busStops
              .map(
                (stop: BusStop) =>
                  `• ${stop.stNm} (${stop.arsId})\n  위치: X=${stop.tmX}, Y=${stop.tmY}\n  정류소ID: ${stop.stId}\n  좌표(GRS80): ${stop.posX}, ${stop.posY}`
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
    console.error("JSON 파싱 오류:", error);
    // JSON 파싱 실패 시 빈 배열 반환
  }

  return busStops;
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

const runServer = async () => {
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
    console.log("SSE connection established");

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
      console.log("SSE connection closed");
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
  console.error(`Fatal error running server: ${error}`);
  process.exit(1);
});
