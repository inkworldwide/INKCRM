import * as XLSX from 'xlsx';

export interface CampaignExportLead {
  _id?: string;
  data?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
  assignedToName?: string;
  assignedToUser?: { firstName?: string; lastName?: string; email?: string };
}

// Universal fuzzy field extractor for campaign leads
const extractField = (dataObj: any, targets: string[], contains: string[] = []): string => {
  if (!dataObj || typeof dataObj !== 'object') return '';
  
  // 1. Direct exact or lowercase match
  for (const t of targets) {
    if (dataObj[t] !== undefined && dataObj[t] !== null) {
      const v = String(dataObj[t]).trim();
      if (v && v !== 'N/A' && v !== 'Unnamed') return v;
    }
  }

  const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normTargets = targets.map(norm);
  const keys = Object.keys(dataObj);

  // 2. Normalized match
  for (const k of keys) {
    if (normTargets.includes(norm(k))) {
      const v = String(dataObj[k] || '').trim();
      if (v && v !== 'N/A' && v !== 'Unnamed') return v;
    }
  }

  // 3. Substring match
  if (contains.length > 0) {
    const normContains = contains.map(norm);
    for (const k of keys) {
      if (normContains.some(c => norm(k).includes(c))) {
        const v = String(dataObj[k] || '').trim();
        if (v && v !== 'N/A' && v !== 'Unnamed') return v;
      }
    }
  }

  return '';
};

export const exportCampaignXLSX = (campaignName: string, leads: any[]) => {
  const headers = [
    'Slno',
    'Data Code',
    'firm_name',
    'contact num',
    'Location',
    'Customer',
    'Case Details',
    'lead_category',
    'Remarks',
    'Agent Assigned To',
    'Dial Status',
    'Dailed Datetime'
  ];

  const formatDateTime = (dateVal?: any) => {
    if (!dateVal) return 'Not Called';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).replace(',', '');
  };

  // Helper to extract Data Code string for sorting
  const getDataCodeStr = (lead: any) => {
    const data = lead.data || lead;
    const raw = extractField(
      data,
      ['dataCode', 'data_code', 'Data Code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code'],
      ['datacode', 'leadcode', 'code']
    ) || data?.dataCode || data?.data_code || data?.['Data Code'] || data?.['data code'] || data?.datacode || data?.DataCode || data?.code || lead?.dataCode || lead?.data_code || lead?.['Data Code'] || '';
    return String(raw || '').trim();
  };

  // Sort leads naturally by Data Code serial number (e.g. A1 CATE B 3695, A1 CATE B 3696...)
  const sortedLeads = [...(leads || [])].sort((a, b) => {
    const codeA = getDataCodeStr(a);
    const codeB = getDataCodeStr(b);
    
    // Extract numeric suffix digits if present
    const matchA = codeA.match(/\d+/g);
    const matchB = codeB.match(/\d+/g);
    const numA = matchA ? parseInt(matchA[matchA.length - 1], 10) : 0;
    const numB = matchB ? parseInt(matchB[matchB.length - 1], 10) : 0;

    if (numA !== numB && !isNaN(numA) && !isNaN(numB) && numA > 0 && numB > 0) {
      return numA - numB;
    }

    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  });

  const dataRows = sortedLeads.map((lead: any, idx: number) => {
    const data = lead.data || lead;
    const slNo = idx + 1; // Strict sequential numbering 1, 2, 3, 4 ... N

    // 1. Data Code
    const rawDataCode = getDataCodeStr(lead);
    const dataCode = (rawDataCode && String(rawDataCode).trim() !== '' && String(rawDataCode).trim() !== 'N/A' && String(rawDataCode).trim() !== 'Unnamed')
      ? String(rawDataCode).trim()
      : (lead._id ? `LND-${lead._id.slice(-6).toUpperCase()}` : 'N/A');

    // 2. firm_name
    const firmName = extractField(
      data,
      ['company', 'firmName', 'firm_name', 'firm', 'businessName', 'business', 'agencyName', 'agency', 'shopName', 'shop', 'tradeName', 'treaderName', 'traderName', 'organization'],
      ['firm', 'company', 'agency', 'business', 'treader', 'trader']
    ) || 'N/A';

    // 3. contact num
    const contactNum = extractField(
      data,
      ['phone', 'mobile', 'contact', 'contactNum', 'contact_num', 'contactNumber', 'contact_number', 'phoneNumber', 'phone_number', 'mobileNo', 'mobile_no', 'contactNo', 'contact_no', 'cell', 'telephone', 'phNo', 'mobNo', 'telNo', 'name_contact_num', 'nameContactNum', 'callNo', 'whatsappNo', 'phone1', 'phone2'],
      ['phone', 'mobile', 'contact', 'cell', 'tele']
    ) || 'N/A';

    // 4. Location
    const location = extractField(
      data,
      ['city', 'location', 'district', 'state', 'address', 'place', 'area', 'branch'],
      ['location', 'city', 'district', 'address']
    ) || 'N/A';

    // 5. Customer
    const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const customer = (fullName && fullName !== 'Unnamed' ? fullName : '') ||
      extractField(
        data,
        ['customer', 'customerName', 'customer_name', 'custName', 'client', 'clientName', 'firstName', 'name', 'fullName', 'buyer', 'buyerName', 'costomer', 'leadName'],
        ['customer', 'client']
      ) || 'N/A';

    // 6. Case Details
    const caseDetails = extractField(
      data,
      ['caseDetails', 'case_details', 'caseStatus', 'case_status', 'details', 'description', 'statusDetail'],
      ['case', 'details']
    ) || 'N/A';

    // 7. lead_category
    const leadCategory = extractField(
      data,
      ['leadCategory', 'lead_category', 'loanType', 'loan_type', 'category', 'product', 'service', 'leadType'],
      ['category', 'loantype']
    ) || 'N/A';

    // 8. Remarks
    const remarks = (extractField(
      data,
      ['notes', 'remarks', 'remark', 'note', 'comment', 'comments', 'feedback'],
      ['remark', 'note', 'comment']
    ) || '').replace(/<[^>]*>/g, '').trim();

    // 9. Agent Assigned To
    let agentAssigned = 'Unassigned';
    if (data.assignedTo) {
      if (typeof data.assignedTo === 'object') {
        agentAssigned = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || data.assignedTo.email || 'Assigned';
      } else {
        agentAssigned = String(data.assignedTo);
      }
    } else if (lead.assignedToUser) {
      agentAssigned = `${lead.assignedToUser.firstName || ''} ${lead.assignedToUser.lastName || ''}`.trim();
    } else if (lead.assignedToName) {
      agentAssigned = String(lead.assignedToName);
    }

    // 10. Dial Status
    const rawSt = data.status || data.dialStatus || data.leadStatus || 'YET TO CALL';
    const dialStatus = String(rawSt).trim().toUpperCase();

    // 11. Dailed Datetime
    const notDialedList = ['YET TO CALL', 'NOT CALLED', 'NEW', ''];
    const isDialed = dialStatus && !notDialedList.includes(dialStatus);
    let dailedDatetime = 'Not Called';
    if (isDialed || data.dialedAt || data.lastCallDate) {
      const dVal = data.dialedAt || data.lastCallDate || lead.updatedAt || data.updatedAt || lead.createdAt;
      dailedDatetime = formatDateTime(dVal);
    }

    return {
      'Slno': slNo,
      'Data Code': dataCode,
      'firm_name': firmName,
      'contact num': contactNum,
      'Location': location,
      'Customer': customer,
      'Case Details': caseDetails,
      'lead_category': leadCategory,
      'Remarks': remarks,
      'Agent Assigned To': agentAssigned,
      'Dial Status': dialStatus,
      'Dailed Datetime': dailedDatetime
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });

  // Compute column widths dynamically
  const colWidths = headers.map(header => {
    let maxLen = header.length;
    dataRows.forEach(row => {
      const val = row[header as keyof typeof row];
      if (val !== undefined && val !== null) {
        maxLen = Math.max(maxLen, String(val).length);
      }
    });
    return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  const safeSheetName = (campaignName || 'Campaign_Report').replace(/[\\/?*[\]]/g, '').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);

  const cleanName = (campaignName || 'Campaign_Report').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${cleanName}_Campaign_Report_${dateStr}.xlsx`);
};

// Also export as CSV with exact 12 columns
export const exportCampaignCSV = (campaignName: string, leads: any[]) => {
  exportCampaignXLSX(campaignName, leads);
};
