import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

      const response = await fetch(url.toString());
      const xmlText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // XML 응답을 파싱하여 JSON으로 변환
      const busStops = parseXmlResponse(xmlText);

      return {
        content: [
          {
            type: "text",
            text: `검색 결과: ${busStops.length}개의 버스 정류소를 찾았습니다.\n\n${busStops
              .map(
                (stop) =>
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
      url.searchParams.append("stSrch", encodeURIComponent(stSrch));

      const response = await fetch(url.toString());
      const xmlText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // XML 응답을 파싱하여 JSON으로 변환
      const busStops = parseXmlResponse(xmlText);

      return {
        content: [
          {
            type: "text",
            text: `"${stSrch}" 검색 결과: ${busStops.length}개의 버스 정류소를 찾았습니다.\n\n${busStops
              .map(
                (stop) =>
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

// XML 응답을 파싱하는 함수
function parseXmlResponse(xmlText: string) {
  const busStops: any[] = [];

  // 간단한 XML 파싱 (실제 프로덕션에서는 xml2js 같은 라이브러리 사용 권장)
  const stationMatches = xmlText.match(/<stationList>[\s\S]*?<\/stationList>/g);

  if (stationMatches) {
    stationMatches.forEach((stationXml) => {
      const stId = extractXmlValue(stationXml, "stId");
      const stNm = extractXmlValue(stationXml, "stNm");
      const tmX = extractXmlValue(stationXml, "tmX");
      const tmY = extractXmlValue(stationXml, "tmY");
      const arsId = extractXmlValue(stationXml, "arsId");
      const posX = extractXmlValue(stationXml, "posX");
      const posY = extractXmlValue(stationXml, "posY");

      if (stId && stNm) {
        busStops.push({
          stId,
          stNm,
          tmX: tmX || "",
          tmY: tmY || "",
          arsId: arsId || "",
          posX: posX || "",
          posY: posY || "",
        });
      }
    });
  }

  return busStops;
}

// XML에서 특정 태그의 값을 추출하는 함수
function extractXmlValue(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
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
  const transport = new StdioServerTransport();

  // EPIPE 에러 처리를 위한 이벤트 리스너 추가
  process.stdout.on("error", (err: any) => {
    if (err.code === "EPIPE") {
      // 클라이언트가 연결을 끊었을 때 발생하는 정상적인 상황
      process.exit(0);
    } else {
      process.stderr.write(`stdout error: ${err.message}\n`);
      process.exit(1);
    }
  });

  process.stdin.on("error", (err: any) => {
    if (err.code === "EPIPE") {
      process.exit(0);
    } else {
      process.stderr.write(`stdin error: ${err.message}\n`);
      process.exit(1);
    }
  });

  try {
    await server.connect(transport);
  } catch (error: any) {
    if (
      error.code === "EPIPE" ||
      (error instanceof Error && error.message.includes("EPIPE"))
    ) {
      // 정상적인 연결 종료
      process.exit(0);
    } else {
      process.stderr.write(`Server connection error: ${error}\n`);
      process.exit(1);
    }
  }
};

runServer().catch((error: any) => {
  if (
    error.code === "EPIPE" ||
    (error instanceof Error && error.message.includes("EPIPE"))
  ) {
    // 정상적인 연결 종료
    process.exit(0);
  } else {
    process.stderr.write(`Fatal error running server: ${error}\n`);
    process.exit(1);
  }
});
