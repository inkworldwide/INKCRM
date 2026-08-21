import * as XLSX from 'xlsx';

export const exportLeadReportXLSX = (leads: any[], fileNamePrefix: string = 'Lead_Report') => {
  const headers = [
    'Sl.No.',
    'Data Code',
    'Createddate',
    'Customer Name',
    'Mobile No',
    'Firm / Company',
    'Turnover / Salary',
    'Loan Amount',
    'present address',
    'City',
    'Loan Product',
    'Bank Names',
    'PSM',
    'Status',
    'Remarks',
    'Source',
    'Assigned To',
    'FollowUp Date',
    'Modified Date'
  ];

  const formatDateShort = (dateStr?: any) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  const formatDateTimeFull = (dateStr?: any) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).replace(',', '');
  };

  const extractField = (dataObj: any, targets: string[], contains: string[] = []): string => {
    if (!dataObj || typeof dataObj !== 'object') return '';
    for (const t of targets) {
      if (dataObj[t] !== undefined && dataObj[t] !== null) {
        const v = String(dataObj[t]).trim();
        if (v && v !== 'N/A' && v !== 'Unnamed') return v;
      }
    }
    const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normTargets = targets.map(norm);
    const keys = Object.keys(dataObj);
    for (const k of keys) {
      if (normTargets.includes(norm(k))) {
        const v = String(dataObj[k] || '').trim();
        if (v && v !== 'N/A' && v !== 'Unnamed') return v;
      }
    }
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

  const dataRows = (leads || []).map((lead: any, idx: number) => {
    const data = lead.data || lead;
    const slNo = idx + 1;
    const dataCode = extractField(
      data,
      ['Data Code', 'dataCode', 'data_code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code'],
      ['datacode', 'leadcode']
    ) || (lead._id ? `LND-${lead._id.slice(-6).toUpperCase()}` : 'N/A');
    const createdDate = formatDateShort(lead.createdAt || data.createdAt || data.createddate);

    const customerName = String(
      `${data.firstName || ''} ${data.lastName || ''}`.trim() ||
      extractField(data, ['customer', 'customerName', 'customer_name', 'custName', 'client', 'clientName', 'firstName', 'name', 'fullName', 'costomer', 'leadName'], ['customer', 'client']) ||
      'N/A'
    ).trim();

    const mobileNo = String(
      extractField(data, ['phone', 'mobile', 'contact', 'contactNum', 'contact_num', 'contactNumber', 'contact_number', 'phoneNumber', 'phone_number', 'mobileNo', 'mobile_no', 'cell', 'telephone', 'phNo', 'mobNo'], ['phone', 'mobile', 'contact', 'cell']) ||
      'N/A'
    ).trim();

    const firmCompany = String(
      extractField(data, ['company', 'firmName', 'firm_name', 'firm', 'firmCompany', 'businessName', 'shopName', 'tradeName', 'organization'], ['firm', 'company', 'business']) ||
      ''
    ).trim();

    const turnoverSalary = String(extractField(data, ['turnover', 'salary', 'income', 'turnoverSalary', 'turnover_salary']) || '').trim();
    const loanAmount = String(extractField(data, ['loanAmount', 'budget', 'amount', 'requiredLoan', 'loan_amount']) || '').trim();
    const presentAddress = String(extractField(data, ['presentAddress', 'address', 'locationAddress', 'present_address', 'fullAddress']) || '').trim();
    const city = String(extractField(data, ['city', 'location', 'district', 'state', 'place', 'area']) || '').trim();
    const loanProduct = String(extractField(data, ['loanProduct', 'loanType', 'product', 'serviceType', 'leadCategory', 'category', 'lead_category']) || '').trim();
    const bankNames = String(extractField(data, ['bankNames', 'bank', 'preferredBank', 'bank_name']) || '').trim();
    const psm = String(extractField(data, ['psm', 'psmName', 'psm_name']) || '').trim();
    const status = String(data.status || 'New').trim();
    const remarks = String(extractField(data, ['remarks', 'notes', 'remark', 'note', 'comment']) || '').trim();
    const source = String(extractField(data, ['source', 'campaign', 'campaignName', 'campaign_name', 'sourceName']) || '').trim();

    let assignedTo = 'Unassigned';
    if (data.assignedTo) {
      if (typeof data.assignedTo === 'object') {
        assignedTo = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || data.assignedTo.email || 'Assigned';
      } else {
        assignedTo = String(data.assignedTo);
      }
    } else if (lead.assignedToUser) {
      assignedTo = `${lead.assignedToUser.firstName || ''} ${lead.assignedToUser.lastName || ''}`.trim();
    } else if (lead.assignedToName) {
      assignedTo = String(lead.assignedToName);
    }

    const followUpDate = formatDateTimeFull(data.followUpDate || data.nextFollowup || data.dialedAt || data.lastCallDate);
    const modifiedDate = formatDateTimeFull(lead.updatedAt || data.updatedAt);

    return {
      'Sl.No.': slNo,
      'Data Code': dataCode,
      'Createddate': createdDate,
      'Customer Name': customerName,
      'Mobile No': mobileNo,
      'Firm / Company': firmCompany,
      'Turnover / Salary': turnoverSalary,
      'Loan Amount': loanAmount,
      'present address': presentAddress,
      'City': city,
      'Loan Product': loanProduct,
      'Bank Names': bankNames,
      'PSM': psm,
      'Status': status,
      'Remarks': remarks,
      'Source': source,
      'Assigned To': assignedTo,
      'FollowUp Date': followUpDate,
      'Modified Date': modifiedDate
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });

  // Dynamic column widths calculation
  const colWidths = headers.map(header => {
    let maxLen = header.length;
    dataRows.forEach(row => {
      const val = row[header as keyof typeof row];
      if (val !== undefined && val !== null) {
        maxLen = Math.max(maxLen, String(val).length);
      }
    });
    return { wch: Math.max(maxLen + 4, 14) };
  });

  // Explicit string formatting for Mobile No to prevent scientific notation (9.6E+09)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const mobileColIdx = headers.indexOf('Mobile No');

  if (mobileColIdx !== -1) {
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: mobileColIdx });
      const cell = worksheet[cellAddress];
      if (cell) {
        cell.t = 's'; // Force STRING cell type
        cell.z = '@'; // Force Text format
      }
    }
  }

  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lead Report');

  const cleanPrefix = (fileNamePrefix || 'Lead_Report').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const fileName = `${cleanPrefix}.xlsx`;

  XLSX.writeFile(workbook, fileName);
};
