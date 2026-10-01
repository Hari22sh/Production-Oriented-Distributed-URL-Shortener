export interface AppConfig {
  port: number;
  baseUrl: string;
  workerId: number;
  database: {
    host: string;
    port: number;
    username: string;
    password?: string;
    database: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    ttlSeconds: number;
  };
  kafka: {
    enabled: boolean;
    brokers: string[];
    clientId: string;
    groupId: string;
    clickTopic: string;
  };
  rateLimit: {
    windowSeconds: number;
    maxRequests: number;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || "3000", 10),
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  workerId: parseInt(process.env.WORKER_ID || "1", 10),
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "url_shortener",
  },
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    ttlSeconds: parseInt(process.env.REDIS_TTL_SECONDS || "86400", 10),
  },
  kafka: {
    enabled: process.env.KAFKA_ENABLED !== "false",
    brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
    clientId: process.env.KAFKA_CLIENT_ID || "url-shortener-service",
    groupId: process.env.KAFKA_GROUP_ID || "url-shortener-group",
    clickTopic: process.env.KAFKA_TOPIC_CLICK_EVENTS || "url-click-events",
  },
  rateLimit: {
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || "60", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "30", 10),
  },
});
