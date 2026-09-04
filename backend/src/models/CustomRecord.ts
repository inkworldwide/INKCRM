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

// Pre-save hook to write normalizedStatus for indexed queries going forward
CustomRecordSchema.pre('save', function (next) {
  if (this.data) {
    const dataObj = this.data instanceof Map ? Object.fromEntries(this.data) : this.data;
    const rawSt = dataObj.status || dataObj.dialStatus || dataObj.leadStatus;
    if (rawSt) {
      const cleanSt = String(rawSt).trim().toUpperCase();
      let normalized = cleanSt;

      if (cleanSt === 'HOT' || cleanSt === 'HOT LEAD' || cleanSt === 'HOT LEADS') normalized = 'HOT LEADS';
      else if (cleanSt === 'WARM' || cleanSt === 'WARM LEAD' || cleanSt === 'WARM LEADS') normalized = 'WARM LEADS';
      else if (cleanSt.includes('CEBIL') || cleanSt.includes('CEDIL') || cleanSt.includes('CIVIL') || cleanSt.includes('CIBIL')) normalized = 'CEBIL PENDING';
      else if (cleanSt.includes('DOCUMENT') || cleanSt.includes('DOC PENDING')) normalized = 'DOCUMENT PENDING';
      else if (cleanSt.includes('APPROVAL PENDING') || cleanSt === 'APPROVAL PENDING') normalized = 'APPROVAL PENDING';
      else if (cleanSt.includes('APPROVED BUT NOT') || cleanSt === 'APPROVED BUT NOT DISBUSE' || cleanSt === 'APPROVED BUT NOT DISBURSED') normalized = 'APPROVED BUT NOT DISBUSE';
      else if (cleanSt === 'APPROVED') normalized = 'APPROVED BUT NOT DISBUSE';
      else if (cleanSt.includes('DISBURS') || cleanSt.includes('DISBUS')) normalized = 'DISBUSED';
      else if (cleanSt.includes('REJECT')) normalized = 'REJECTED';
      else if (cleanSt.includes('FOLLOW')) normalized = 'FOLLOWUP';
      else if (cleanSt.includes('DROP')) normalized = 'DROPPED';
      else if (cleanSt === 'PENDING') normalized = 'PENDING';

      if (this.data instanceof Map) {
        this.data.set('normalizedStatus', normalized);
      } else {
        (this.data as any).normalizedStatus = normalized;
      }
    }
  }
  next();
});

// Indexes for fast querying, aggregations, sorting & multi-tenant isolation
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, createdAt: 1, 'data.normalizedStatus': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.assignedTo': 1, 'data.normalizedStatus': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.assignedTo': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.telecaller': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.assignedAgent': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.assignedToName': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.campaignName': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.source': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.campaign': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.campaign_name': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.normalizedStatus': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.status': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.dialStatus': 1, createdAt: -1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.followUpDate': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.dataCode': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.data_code': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.phone': 1 });
CustomRecordSchema.index({ organizationId: 1, moduleId: 1, 'data.mobile': 1 });
CustomRecordSchema.index({ organizationId: 1, 'data.email': 1 });
CustomRecordSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.model<ICustomRecord>('CustomRecord', CustomRecordSchema);
