export const exportLeadReportXLSX = async (leads: any[], fileNamePrefix: string = 'Lead_Report') => {
  const XLSX = await import('xlsx');
  const headers = [
    'Sl.No.',
    'Data Code',
    'firm_name',
    'contact num',
    'Location',
    'Customer Name',
    'Loan Product',
    'Loan Amount',
    'Case Details',
    'Status',
    'Remarks',
    'Source',
    'Assigned To',
    'Createddate',
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

  // Helper to extract Data Code string for sorting and export with 100% reliability
  const getDataCodeStr = (lead: any) => {
    if (!lead) return '';
    const d = lead.data || lead;
    
    // 1. Direct targets & fuzzy extractField on lead.data
    let raw = extractField(
      d,
      ['dataCode', 'data_code', 'Data Code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code', 'leadScore'],
      ['datacode', 'leadcode', 'code']
    );

    // 2. Direct targets & fuzzy extractField on top-level lead
    if (!raw && lead.data) {
      raw = extractField(
        lead,
        ['dataCode', 'data_code', 'Data Code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code', 'leadScore'],
        ['datacode', 'leadcode', 'code']
      );
    }

    // 3. Scan all keys of d (case/space/symbol agnostic)
    if (!raw && d && typeof d === 'object') {
      const keys = Object.keys(d);
      for (const k of keys) {
        const lowerK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lowerK.includes('datacode') || lowerK.includes('data_code') || lowerK === 'code' || lowerK.includes('leadcode')) {
          const v = String(d[k] || '').trim();
          if (v && v !== 'N/A' && v !== 'Unnamed') {
            raw = v;
            break;
          }
        }
      }

      // 4. Fallback: Check 2nd key (Column B) if Data Code column header was custom named
      if (!raw && keys.length >= 2) {
        const colBVal = String(d[keys[1]] || '').trim();
        if (colBVal && colBVal !== 'N/A' && colBVal !== 'Unnamed' && !colBVal.startsWith('http') && colBVal.length >= 3) {
          raw = colBVal;
        }
      }
    }

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
    
    const rawDataCode = getDataCodeStr(lead);
    const dataCode = (rawDataCode && String(rawDataCode).trim() !== '' && String(rawDataCode).trim() !== 'N/A' && String(rawDataCode).trim() !== 'Unnamed')
      ? String(rawDataCode).trim()
      : (lead._id ? `LND-${lead._id.slice(-6).toUpperCase()}` : 'N/A');

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
      'N/A'
    ).trim();

    const loanAmountRaw = extractField(data, ['loanAmount', 'budget', 'amount', 'requiredLoan', 'loan_amount']);
    const numAmt = Number(loanAmountRaw);
    const loanAmount = (!isNaN(numAmt) && numAmt > 0) ? `₹${numAmt.toLocaleString('en-IN')}` : (loanAmountRaw || 'N/A');

    const city = String(extractField(data, ['city', 'location', 'district', 'state', 'address', 'place', 'area', 'presentAddress', 'fullAddress']) || 'N/A').trim();
    const loanProduct = String(extractField(data, ['loanProduct', 'loanType', 'product', 'serviceType', 'leadCategory', 'category', 'lead_category']) || 'SALARIED PERSONAL LOAN').trim();
    const caseDetails = String(extractField(data, ['caseDetails', 'case_details', 'caseStatus', 'details', 'description']) || 'N/A').trim();
    const status = String(
      data.normalizedStatus ||
      (data.status && data.status !== 'New' ? data.status : '') ||
      (data.dialStatus && data.dialStatus !== 'Yet To Call' ? data.dialStatus : '') ||
      data.leadStatus ||
      data.status ||
      data.dialStatus ||
      'YET TO CALL'
    ).trim();
    const remarks = String(extractField(data, ['remarks', 'notes', 'remark', 'note', 'comment']) || '').replace(/<[^>]*>/g, '').trim();
    const source = String(extractField(data, ['source', 'campaign', 'campaignName', 'campaign_name', 'sourceName']) || 'N/A').trim();

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

    const modifiedDate = formatDateTimeFull(lead.updatedAt || data.updatedAt);

    return {
      'Sl.No.': slNo,
      'Data Code': dataCode,
      'firm_name': firmCompany,
      'contact num': mobileNo,
      'Location': city,
      'Customer Name': customerName,
      'Loan Product': loanProduct,
      'Loan Amount': loanAmount,
      'Case Details': caseDetails,
      'Status': status,
      'Remarks': remarks,
      'Source': source,
      'Assigned To': assignedTo,
      'Createddate': createdDate,
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

  // Explicit string formatting for contact num to prevent scientific notation (9.6E+09)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const mobileColIdx = headers.indexOf('contact num');

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
