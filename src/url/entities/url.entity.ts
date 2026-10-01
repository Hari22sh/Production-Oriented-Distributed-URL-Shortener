import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity({ name: "urls" })
@Index(["shortCode"], { unique: true })
@Index(["originalUrl"], { unique: true })
@Index(["expiresAt"])
export class UrlEntity {
  @PrimaryColumn({ type: "bigint" })
  id!: string; // Snowflake ID stored as bigint string

  @Column({ type: "varchar", length: 16, unique: true })
  shortCode!: string;

  @Column({ type: "text", unique: true })
  originalUrl!: string;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;
}
