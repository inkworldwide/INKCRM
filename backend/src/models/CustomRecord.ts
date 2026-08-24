import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomRecord extends Document {
  organizationId: mongoose.Types.ObjectId;
  moduleId: mongoose.Types.ObjectId;
  data: Record<string, any>; // Stores the dynamic fields key-value pairs
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CustomRecordSchema = new Schema<ICustomRecord>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'ModuleDefinition', required: true },
    data: { type: Schema.Types.Map, of: Schema.Types.Mixed, default: {} },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true, strict: false } // strict: false allows saving unstructured sub-fields directly
);

// Indexes for fast querying, aggregations, sorting & multi-tenant isolation
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.assignedTo': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.campaignName': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.source': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.campaign': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.dataCode': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.phone': 1 });
CustomRecordSchema.index({ 'data.email': 1 });
CustomRecordSchema.index({ createdAt: -1 });

export default mongoose.model<ICustomRecord>('CustomRecord', CustomRecordSchema);
