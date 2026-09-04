import mongoose, { Schema, Document } from 'mongoose';

export interface ISummaryStats extends Document {
  organizationId: mongoose.Types.ObjectId;
  moduleId: mongoose.Types.ObjectId;
  type: 'dashboard_status' | 'campaign_summary';
  key: string; // Status canonical name or Campaign name
  count: number;
  dialedCount?: number;
  yetToDialCount?: number;
  lastUpdated: Date;
}

const SummaryStatsSchema = new Schema<ISummaryStats>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'ModuleDefinition', required: true },
    type: { type: String, enum: ['dashboard_status', 'campaign_summary'], required: true },
    key: { type: String, required: true, trim: true },
    count: { type: Number, default: 0 },
    dialedCount: { type: Number, default: 0 },
    yetToDialCount: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
  },
  { timestamps: true, versionKey: false }
);

SummaryStatsSchema.index({ organizationId: 1, moduleId: 1, type: 1, key: 1 }, { unique: true });

export default mongoose.model<ISummaryStats>('SummaryStats', SummaryStatsSchema);
