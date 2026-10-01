import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import { RedisService } from "../cache/redis.service";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Check health status of Application, PostgreSQL, and Redis",
  })
  @ApiResponse({ status: 200, description: "Health check report" })
  async checkHealth() {
    let dbStatus = "down";
    try {
      if (this.dataSource.isInitialized) {
        await this.dataSource.query("SELECT 1");
        dbStatus = "up";
      }
    } catch {
      dbStatus = "down";
    }

    let redisStatus = "down";
    try {
      const client = this.redisService.getClient();
      if (client && client.status === "ready") {
        const pingRes = await client.ping();
        if (pingRes === "PONG") {
          redisStatus = "up";
        }
      }
    } catch {
      redisStatus = "down";
    }

    const isHealthy = dbStatus === "up" && redisStatus === "up";

    return {
      status: isHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        application: "up",
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
