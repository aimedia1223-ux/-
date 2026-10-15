import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import Papa from 'papaparse';
import { api } from '../data/mockDb';
import type { Job, Talent, Staff, Training, User, ContractTask } from '../data/mockDb';
import { CalendarPicker } from '../components/CalendarPicker';
import { formatJobDates } from '../utils/dateFormatter';
import { generateMaskedLocation, extractArea, getCommonAreaName } from '../utils/maskingUtils';
import { isWithinAreaFilter, distanceKm } from '../utils/areaFilter';
import { getLinkedJobIds } from '../utils/jobStates';
import { PREFECTURE_REGIONS, ALL_PREFECTURES, getCityArea, matchesPrefectureFilter } from '../utils/prefectures';
import Autocomplete from 'react-google-autocomplete';
import { useSessionState } from '../hooks/useSessionState';

// 「3年以上」「5年」「未経験」などの自由記述から経験年数(概算)を取り出す。
export const parseExperienceYears = (exp?: string | null): number => {
  if (!exp) return 0;
  if (exp.includes('未経験')) return 0;
  const m = exp.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
};

// ATTENDANCE_LOG_ / CHECKIN_STATUS_ を除いた「研修」受講数。
export const countRealTrainings = (list?: string[] | null): number => {
  if (!Array.isArray(list)) return 0;
  return list.filter((t) => !t.startsWith('ATTENDANCE_LOG_') && !t.startsWith('CHECKIN_STATUS_')).length;
};

// 単価スライダーの範囲(円/日)。上限に張り付いた状態は「上限なし」扱い。
export const PRICE_SLIDER_MIN = 0;
export const PRICE_SLIDER_MAX = 50000;
export const PRICE_SLIDER_STEP = 1000;

export const getStaffGender = (name: string): '男性' | '女性' => {
  const femaleNames = ['舞', '優花', '陽子', '沙織', '美咲', '愛', '結衣', '莉子', '咲良', '葵', 'さくら', 'つばさ'];
  const firstName = name.split(/[\s　]+/)[1] || name;
  const isFemale = femaleNames.includes(firstName) || firstName.endsWith('子') || firstName.endsWith('美');
  return isFemale ? '女性' : '男性';
};

export function SearchPage() {
  const navigate = useNavigate();
  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const advancedMarkerClassRef = useRef<any>(null);
  const infoWindowClassRef = useRef<any>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [mapZoom, setMapZoom] = useState(14);

  const [mode, setMode] = useSessionState<'talent' | 'job'>('connexy_mode', 'job');
  const [viewMode, setViewMode] = useSessionState<'map' | 'list'>('connexy_viewMode', 'map');
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [talents, setTalents] = useState<Talent[]>([]);
  const [contractTasks, setContractTasks] = useState<ContractTask[]>([]);
  const [filterArea, setFilterArea] = useSessionState<string>('connexy_filterArea', 'all');
  const [allTrainings, setAllTrainings] = useState<Training[]>([]);

  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedJobRating, setSelectedJobRating] = useState<{average: number, count: number} | null>(null);
  const [selectedTalentRating, setSelectedTalentRating] = useState<{average: number, count: number} | null>(null);

  useEffect(() => {
    if (selectedJob && selectedJob.authorId) {
      api.getUserAverageRating(selectedJob.authorId).then(setSelectedJobRating);
    } else {
      setSelectedJobRating(null);
    }
  }, [selectedJob]);

  useEffect(() => {
    if (selectedTalent && selectedTalent.userId) {
      api.getUserAverageRating(selectedTalent.userId).then(setSelectedTalentRating);
    } else {
      setSelectedTalentRating(null);
    }
  }, [selectedTalent]);

  // 新規作成フォーム用のState
  const [visibleCount, setVisibleCount] = useState(10);
  
  // 一括スカウト用State
  const [selectedTalentIds, setSelectedTalentIds] = useState<string[]>([]);
  const [showBulkScoutModal, setShowBulkScoutModal] = useState(false);
  const [bulkScoutMessage, setBulkScoutMessage] = useState('はじめまして！ご経歴とご実績を拝見し、ぜひ弊社のイベント・店舗支援案件にご参画いただきたくスカウトを送らせていただきました。条件面など詳細についてご相談可能です。');

  const handleToggleSelectTalent = (talentId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedTalentIds(prev => 
      prev.includes(talentId) ? prev.filter(id => id !== talentId) : [...prev, talentId]
    );
  };

  const handleSendBulkScout = async () => {
    if (selectedTalentIds.length === 0 || !currentUser) return;
    try {
      for (const tId of selectedTalentIds) {
        const talentObj = talents.find(t => t.id === tId);
        const targetUserId = talentObj ? (talentObj.userId || talentObj.companyName) : tId;
        const chatId = `chat_${[currentUser.id, targetUserId].sort().join('_')}`;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const initMsgs = [
          {
            id: 'msg_' + Date.now() + Math.random(),
            senderId: currentUser.id,
            senderName: currentUser.name,
            text: bulkScoutMessage,
            time: timeStr
          }
        ];
        await api.saveContractTaskChat(chatId, initMsgs, '【一括スカウト】新規案件のご案内', currentUser.name, talentObj?.companyName || 'スカウト対象パートナー');
      }
      alert(`${selectedTalentIds.length}名の人材へ一括スカウトを正常に送信いたしました！`);
      setShowBulkScoutModal(false);
      setSelectedTalentIds([]);
    } catch (e) {
      console.error(e);
      alert('一括スカウトの送信に失敗しました');
    }
  };

  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [createFormType, setCreateFormType] = useState<'job' | 'talent'>('job');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingLocationName, setIsEditingLocationName] = useState(false);
  const [mapSelectionKey, setMapSelectionKey] = useState(0);
  
  // スタッフ関連のState
  const [myStaffs, setMyStaffs] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [talentPrice, setTalentPrice] = useState<number>(15000);

  // フィルタ関連のState

  // マップ上のピンをクリックした際に下部ボトムシートに表示する案件・人材データ
  const [selectedMapJobs, setSelectedMapJobs] = useState<Job[] | null>(null);
  const [selectedMapTalents, setSelectedMapTalents] = useState<{ locationName: string, talents: Talent[] } | null>(null);

  // 案件作成用の新規State
  const [selectedJobDates, setSelectedJobDates] = useState<string[]>([]);
  const [isSelectingLocationOnMap, setIsSelectingLocationOnMap] = useState(false);
  const [tempSelectedLocation, setTempSelectedLocation] = useState<{ lat: number, lng: number } | null>(null);
  const tempMarkerRef = useRef<any>(null);
  const [isNdaModalOpen, setIsNdaModalOpen] = useState(false);
  const [ndaAgreed, setNdaAgreed] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvPreviewData, setCsvPreviewData] = useState<{ data: any[]; errors: { rowIndex: number; message: string }[] } | null>(null);
  

  // ログインユーザーおよび限定公開先の動的管理用State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [targetCompanyId, setTargetCompanyId] = useState<string>('');

  const pastTradeCompanyIds = useMemo(() => {
    if (!currentUser || !contractTasks) return new Set<string>();
    const completedTasks = contractTasks.filter(t => t.status === 'completed');
    const set = new Set<string>();
    completedTasks.forEach(t => {
      const tAgencyId = t.agency_id || (t.companyName?.includes('アルファ') ? 'alpha' : t.companyName?.includes('シグマ') ? 'sigma' : t.companyName?.includes('ベータ') ? 'beta' : t.companyName?.includes('ガンマ') ? 'gamma' : t.companyName?.includes('デルタ') ? 'delta' : t.companyName?.includes('SEALs') ? 'seals' : t.companyName?.includes('FreeR') ? 'freer' : t.companyName?.includes('ココラボ') ? 'cocolabo' : '');
      const tClientId = t.client_id || (t.clientName?.includes('アルファ') ? 'alpha' : t.clientName?.includes('シグマ') ? 'sigma' : t.clientName?.includes('ベータ') ? 'beta' : t.clientName?.includes('ガンマ') ? 'gamma' : t.clientName?.includes('デルタ') ? 'delta' : t.clientName?.includes('SEALs') ? 'seals' : t.clientName?.includes('FreeR') ? 'freer' : t.clientName?.includes('ココラボ') ? 'cocolabo' : '');
      if (tAgencyId === currentUser.id) {
        if (tClientId) set.add(tClientId);
      } else if (tClientId === currentUser.id) {
        if (tAgencyId) set.add(tAgencyId);
      }
    });
    return set;
  }, [currentUser, contractTasks]);

  // フィルター・ソート用State
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [isPrefPickerOpen, setIsPrefPickerOpen] = useState(false);
  const [prefPickerQuery, setPrefPickerQuery] = useState('');
  const [searchKeyword, setSearchKeyword] = useSessionState<string>('connexy_searchKeyword', '');

  // 「現在地から近い順」用の位置情報(取得できなければ null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // 都道府県フィルタ(案件・人材で共通)
  const [filterPrefectures, setFilterPrefectures] = useSessionState<string[]>('connexy_filterPrefectures', []);

  // 案件用フィルター & ソート
  const [jobSortOrder, setJobSortOrder] = useSessionState<'newest' | 'priceHigh' | 'priceLow' | 'deadlineNear' | 'dateNear' | 'nearest'>('connexy_jobSortOrder', 'newest');
  const [filterJobRoles, setFilterJobRoles] = useSessionState<string[]>('connexy_filterJobRoles', []);
  const [filterCarriers, setFilterCarriers] = useSessionState<string[]>('connexy_filterCarriers', []);
  const [filterChannels, setFilterChannels] = useSessionState<string[]>('connexy_filterChannels', []);
  const [filterMinPrice, setFilterMinPrice] = useSessionState<number>('connexy_filterMinPrice', 0);
  const [filterMaxPrice, setFilterMaxPrice] = useSessionState<number>('connexy_filterMaxPrice', PRICE_SLIDER_MAX);
  const [filterDeadlineDays, setFilterDeadlineDays] = useSessionState<number | null>('connexy_filterDeadlineDays', null);
  const [filterHasExpenses, setFilterHasExpenses] = useSessionState<boolean>('connexy_filterHasExpenses', false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useSessionState<boolean>('connexy_showFavoritesOnly', false);


  // 人材用フィルター & ソート
  const [talentSortOrder, setTalentSortOrder] = useSessionState<'priceLow' | 'priceHigh' | 'expLong' | 'trainingsMany' | 'nearest'>('connexy_talentSortOrder', 'priceLow');
  const [filterTalentSkills, setFilterTalentSkills] = useSessionState<string[]>('connexy_filterTalentSkills', []);
  const [filterTalentCarriers, setFilterTalentCarriers] = useSessionState<string[]>('connexy_filterTalentCarriers', []);
  const [filterTalentTrainings, setFilterTalentTrainings] = useSessionState<string[]>('connexy_filterTalentTrainings', []);
  const [filterMinExperience, setFilterMinExperience] = useSessionState<number>('connexy_filterMinExperience', 0);

  const requestLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  };

  // 位置情報は初回に一度だけ取得(未許可・失敗なら「近い順」は無効表示)
  useEffect(() => {
    requestLocation();
  }, []);

  const [isSamePriceAllDates, setIsSamePriceAllDates] = useState(true);

  useEffect(() => {
    if (viewMode === 'list') {
      setSelectedMapJobs(null);
      setSelectedMapTalents(null);
    }
  }, [viewMode]);

  // 汎用フォームState (Job用) + Talent用希望勤務日
  const [formData, setFormData] = useState({
    title: '', description: '', price: '' as unknown as number, 
    locationName: '', // 公開用の表示名
    exactLocation: '', // 正確な店舗名・住所
    roleType: '' as any, salesChannel: '' as any, carrier: '' as any,
    availableDates: '', // 案件用など（未使用になるかも）
    selectedDates: [] as string[], // カレンダーで選択された日付
    eventDate: '',
    applicationDeadline: '',
    workLocation: '店内',
    isUrgent: false,
    isLimited: false
  });

  const [commonPrice, setCommonPrice] = useState<number>(0);
  const [dailyPrices, setDailyPrices] = useState<{ [date: string]: number }>({});
  const [expenses, setExpenses] = useState<{
    transportType: 'none' | 'pay_separate' | 'arranged' | 'actual' | 'flat';
    transportValue: number;
    accommodationType: 'none' | 'pay_separate' | 'arranged' | 'actual' | 'flat';
    accommodationValue: number;
  }>({
    transportType: 'none',
    transportValue: 0,
    accommodationType: 'none',
    accommodationValue: 0
  });

  // selectedJobDatesの変更に応じてdailyPricesのキーを更新
  useEffect(() => {
    setDailyPrices(prev => {
      const nextPrices = { ...prev };
      // 新しく選択された日付があれば追加
      selectedJobDates.forEach(date => {
        if (!(date in nextPrices)) {
          nextPrices[date] = commonPrice || 0;
        }
      });
      // 選択解除された日付があれば削除
      Object.keys(nextPrices).forEach(date => {
        if (!selectedJobDates.includes(date)) {
          delete nextPrices[date];
        }
      });
      return nextPrices;
    });
  }, [selectedJobDates]); // commonPrice は初回追加時のみ使用するため依存に含めない

  // 全日程同一価格が有効な場合、commonPriceの変更を全ての日程に同期
  useEffect(() => {
    if (isSamePriceAllDates) {
      setDailyPrices(prev => {
        const nextPrices: { [date: string]: number } = {};
        Object.keys(prev).forEach(date => {
          nextPrices[date] = commonPrice;
        });
        return nextPrices;
      });
    }
  }, [commonPrice, isSamePriceAllDates]);

  // 「すべての稼働日で同じ単価を設定する」チェックボックスの切り替え処理
  // 日程別に入力済みの単価を、未入力のcommonPriceで一律上書きしてしまわないよう、
  // 既存の日程別単価から代表値を引き継いでからオンにする
  const handleToggleSamePrice = (checked: boolean) => {
    if (checked) {
      const existingValues = Object.values(dailyPrices);
      const seedPrice = existingValues.length > 0 ? existingValues[0] : commonPrice;
      setCommonPrice(seedPrice);
    }
    setIsSamePriceAllDates(checked);
  };

  // 案件情報複製処理（コピーして新規作成）
  const handleDuplicateJob = (job: Job) => {
    setFormData({
      title: `${job.title} (コピー)`,
      description: job.description,
      price: job.price,
      locationName: job.locationName || '',
      exactLocation: job.exactLocation || '',
      roleType: job.roleType || '',
      salesChannel: job.salesChannel || '',
      carrier: job.carrier || '',
      availableDates: '',
      selectedDates: [],
      eventDate: job.eventDate || '',
      applicationDeadline: job.applicationDeadline || '',
      workLocation: job.workLocation || '店内',
      isUrgent: job.isUrgent || false,
      isLimited: (job.allowedCompanyIds && job.allowedCompanyIds.length > 0) || false
    });

    const dates = job.eventDate ? job.eventDate.split(', ').filter(Boolean) : [];
    setSelectedJobDates(dates);

    if (job.dailyPrices && Object.keys(job.dailyPrices).length > 0) {
      setDailyPrices({ ...job.dailyPrices });
      const prices = Object.values(job.dailyPrices);
      const firstPrice = prices[0] || 0;
      const allSame = prices.every(p => p === firstPrice);
      setIsSamePriceAllDates(allSame);
      if (allSame) {
        setCommonPrice(firstPrice);
      } else {
        setCommonPrice(0);
      }
    } else {
      setIsSamePriceAllDates(true);
      setCommonPrice(job.price);
      const fallbackPrices: { [date: string]: number } = {};
      dates.forEach(d => {
        fallbackPrices[d] = job.price;
      });
      setDailyPrices(fallbackPrices);
    }

    if (job.expenses) {
      setExpenses({
        transportType: job.expenses.transportType || 'none',
        transportValue: job.expenses.transportValue || 0,
        accommodationType: job.expenses.accommodationType || 'none',
        accommodationValue: job.expenses.accommodationValue || 0
      });
    } else {
      setExpenses({
        transportType: 'none',
        transportValue: 0,
        accommodationType: 'none',
        accommodationValue: 0
      });
    }

    if (job.allowedCompanyIds && job.allowedCompanyIds.length > 0) {
      setTargetCompanyId(job.allowedCompanyIds[0]);
    } else {
      setTargetCompanyId('');
    }

    setTempSelectedLocation({ lat: job.exactLat || job.lat, lng: job.exactLng || job.lng });

    setCreateFormType('job');
    setIsEditingLocationName(false);
    setIsCreateFormOpen(true);
    setSelectedJob(null);
  };

  // お気に入りはハート押下で即トグル(保存先の選択は行わない)。
  const handleToggleFavoriteJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;
    const newFavorites = await api.toggleFavoriteJob(currentUser.id, jobId);
    setCurrentUser({ ...currentUser, favoriteJobIds: newFavorites });
  };

  const handleToggleFavoriteTalent = async (talentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;
    const newFavorites = await api.toggleFavoriteTalent(currentUser.id, talentId);
    setCurrentUser({ ...currentUser, favoriteTalentIds: newFavorites });
  };

  // 一覧表示での単価・総額レンダリング
  const renderJobPrice = (job: Job) => {
    if (job.dailyPrices && Object.keys(job.dailyPrices).length > 0) {
      const prices = Object.values(job.dailyPrices);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      if (minPrice === maxPrice) {
        return (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ display: 'flex', alignItems: 'baseline' }}>
              <span className="job-price" style={{ fontSize: '16px' }}>¥{minPrice?.toLocaleString()}</span>
              <span className="job-price-unit" style={{ fontSize: '10px', color: 'var(--text-sub)' }}>/ 日</span>
            </span>
            <span style={{ fontSize: '11px', color: '#1E40AF', fontWeight: 'bold' }}>合計 ¥{job.price?.toLocaleString()}</span>
          </span>
        );
      } else {
        return (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ display: 'flex', alignItems: 'baseline' }}>
              <span className="job-price" style={{ fontSize: '14px' }}>¥{minPrice?.toLocaleString()}〜{maxPrice?.toLocaleString()}</span>
              <span className="job-price-unit" style={{ fontSize: '10px', color: 'var(--text-sub)' }}>/ 日</span>
            </span>
            <span style={{ fontSize: '11px', color: '#1E40AF', fontWeight: 'bold' }}>合計 ¥{job.price?.toLocaleString()}</span>
          </span>
        );
      }
    }
    return (
      <>
        <span className="job-price">¥{job.price?.toLocaleString()}</span>
        <span className="job-price-unit">/ 日</span>
      </>
    );
  };

  // データ更新State & 処理
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const [fetchedJobs, fetchedTalents, fetchedTrainings, user, users, fetchedContractTasks] = await Promise.all([
        api.getJobs(),
        api.getTalents(),
        api.getTrainings(),
        api.getCurrentUser(),
        api.getUsers(),
        api.getContractTasks()
      ]);
      setJobs(fetchedJobs);
      setTalents(fetchedTalents);
      setAllTrainings(fetchedTrainings);
      setCurrentUser(user);
      setAllUsers(users);
      setContractTasks(fetchedContractTasks);
      // アニメーションを自然に見せるために、わずかにディレイをかける
      await new Promise(resolve => setTimeout(resolve, 400));
    } catch (error) {
      console.error('データの更新に失敗しました', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleOpenCreateForm = async () => {
    const currentUser = await api.getCurrentUser();
    if (!currentUser) return;
    const staffs = await api.getStaffsByUserId(currentUser.id);
    setMyStaffs(staffs);
    if (staffs.length > 0) setSelectedStaffId(staffs[0].id);
    setCreateFormType(mode);
    setIsEditingLocationName(false);
    setIsCreateFormOpen(true);
  };

  const downloadCsvTemplate = () => {
    const header = mode === 'job' 
      ? 'title,description,locationName,price,eventDate\n案件タイトル,案件詳細,東京都新宿区...,15000,2024-12-01'
      : 'name,skills,baseLocation,price,experience\n人材 太郎,営業,東京都新宿区,15000,3年';
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), header], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', mode === 'job' ? 'job_template.csv' : 'talent_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      // papaparse handles quoted fields (incl. embedded commas/newlines) and CRLF line endings
      // correctly, unlike a plain text.split('\n') + split(',').
      const rows = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
      if (rows.length <= 1) {
        alert('CSVデータが空かヘッダーのみです');
        return;
      }

      try {
        setIsRefreshing(true);
        const currentUser = await api.getCurrentUser();
        if (!currentUser) throw new Error('未ログイン');

        let parsedData: any[] = [];
        let errors: { rowIndex: number; message: string }[] = [];
        // 空行を除いた「表示行番号」。parsedDataへの追加ごとに1つずつ振るため、
        // errorsのrowIndexとプレビュー表内のインデックス(idx+1)が常に一致する
        let rowIndex = 0;

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          rowIndex++;

          if (mode === 'job') {
            if (cols.length < 5) {
              errors.push({ rowIndex, message: '列数が不足しています' });
              parsedData.push({
                id: 'job_' + Date.now() + '_' + i,
                authorId: currentUser.id,
                title: cols[0] || '(不明)',
                description: cols[1] || '',
                locationName: cols[2] || '',
                lat: 35.68,
                lng: 139.76,
                price: parseInt(cols[3]) || 0,
                eventDate: cols[4] || '未定'
              } as Job);
              continue;
            }
            // Validation
            if (!cols[0]) errors.push({ rowIndex, message: 'タイトルが空です' });
            if (!cols[3] || isNaN(parseInt(cols[3]))) errors.push({ rowIndex, message: '単価が不正です' });

            const newJob: Job = {
              id: 'job_' + Date.now() + '_' + i,
              authorId: currentUser.id,
              title: cols[0],
              description: cols[1],
              locationName: cols[2],
              lat: 35.68 + (Math.random() * 0.1), // モック処理
              lng: 139.76 + (Math.random() * 0.1),
              price: parseInt(cols[3]) || 0,
              eventDate: cols[4] || '未定'
            };
            parsedData.push(newJob);
          } else if (mode === 'talent') {
            if (cols.length < 5) {
              errors.push({ rowIndex, message: '列数が不足しています' });
              parsedData.push({
                id: 'talent_' + Date.now() + '_' + i,
                userId: currentUser.id,
                companyName: currentUser.name,
                name: cols[0] || '(不明)',
                maskedName: (cols[0] || '?').substring(0, 1) + '○',
                description: 'インポートされたデータ',
                locationName: cols[2] || '',
                skills: cols[1] ? [cols[1]] : [],
                baseLocation: cols[2] || '',
                lat: 35.68,
                lng: 139.76,
                price: parseInt(cols[3]) || 0,
                experience: cols[4] || '未経験'
              } as Talent);
              continue;
            }
            // Validation
            if (!cols[0]) errors.push({ rowIndex, message: '名前が空です' });
            if (!cols[3] || isNaN(parseInt(cols[3]))) errors.push({ rowIndex, message: '単価が不正です' });

            const newTalent: Talent = {
              id: 'talent_' + Date.now() + '_' + i,
              userId: currentUser.id,
              companyName: currentUser.name,
              name: cols[0],
              maskedName: cols[0].substring(0, 1) + '○',
              description: 'インポートされたデータ',
              locationName: cols[2],
              skills: [cols[1]],
              baseLocation: cols[2],
              lat: 35.68 + (Math.random() * 0.1),
              lng: 139.76 + (Math.random() * 0.1),
              price: parseInt(cols[3]) || 0,
              experience: cols[4] || '未経験'
            };
            parsedData.push(newTalent);
          }
        }

        setCsvPreviewData({ data: parsedData, errors });
        await handleRefresh();
      } catch (err) {
        console.error(err);
        alert('CSVのインポートに失敗しました');
      } finally {
        setIsRefreshing(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmCsvRegistration = async () => {
    if (!csvPreviewData || csvPreviewData.errors.length > 0) return;
    try {
      setIsRefreshing(true);
      let successCount = 0;
      for (const item of csvPreviewData.data) {
        if (mode === 'job') {
          await api.addJob(item as Job);
        } else {
          await api.addTalent(item as Talent);
        }
        successCount++;
      }
      alert(`${successCount}件のデータを一括登録しました`);
      setIsCsvModalOpen(false);
      setCsvPreviewData(null);
      await handleRefresh();
    } catch(err) {
      console.error(err);
      alert('CSVの登録に失敗しました');
    } finally {
      setIsRefreshing(false);
    }
  };

  const geocodeAddress = async (address: string): Promise<{lat: number, lng: number}> => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
      const data = await response.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch (e) {
      console.warn("Geocoding failed", e);
    }
    return { lat: 35.6812, lng: 139.7671 }; // Fallback to Tokyo Station
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    if (createFormType === 'job' && selectedJobDates.length === 0) {
      alert('開催日を1日以上選択してください。');
      setIsSubmitting(false);
      return;
    }

    let ambiguousCoords = { lat: 35.6812, lng: 139.7671 };
    let exactCoords = tempSelectedLocation || { lat: 35.6812, lng: 139.7671 };

    if (createFormType === 'job') {
      const area = extractArea(formData.exactLocation || formData.locationName);
      if (area && area !== '非公開エリア') {
        const geocoded = await geocodeAddress(area);
        if (geocoded) ambiguousCoords = geocoded;
      } else if (tempSelectedLocation) {
        // Fallback to exact if area extraction fails (though this defeats masking, it's a fallback)
        ambiguousCoords = tempSelectedLocation;
      }
    }

    if (createFormType === 'job') {
      const totalPrice = Object.values(dailyPrices).reduce((sum, val) => sum + val, 0);

      const newJob: Omit<Job, 'id'> = {
        title: formData.title,
        description: formData.description,
        price: totalPrice,
        locationName: formData.locationName,
        exactLocation: formData.exactLocation,
        lat: ambiguousCoords.lat,
        lng: ambiguousCoords.lng,
        exactLat: exactCoords.lat,
        exactLng: exactCoords.lng,
        authorId: currentUser?.id || '',
        roleType: formData.roleType as Job['roleType'],
        salesChannel: formData.salesChannel as Job['salesChannel'],
        carrier: formData.carrier as Job['carrier'],
        detailedDescription: formData.description,
        eventDate: [...selectedJobDates].sort().join(', '),
        applicationDeadline: formData.applicationDeadline,
        workLocation: formData.workLocation as Job['workLocation'],
        isUrgent: formData.isUrgent,
        allowedCompanyIds: formData.isLimited && targetCompanyId ? [targetCompanyId] : undefined,
        dailyPrices,
        expenses
      };
      const savedJob = await api.addJob(newJob);
      setJobs(prev => [...prev, savedJob]);

      // クリーンアップ
      if (tempMarkerRef.current) {
        tempMarkerRef.current.map = null;
        tempMarkerRef.current = null;
      }
      setTempSelectedLocation(null);
      setSelectedJobDates([]);
      setCommonPrice(0);
      setDailyPrices({});
      setExpenses({
        transportType: 'none',
        transportValue: 0,
        accommodationType: 'none',
        accommodationValue: 0
      });
      setIsSamePriceAllDates(true);
      setIsEditingLocationName(false);
    } else {
      const selectedStaff = myStaffs.find(s => s.id === selectedStaffId);
      if (!selectedStaff) {
        alert('スタッフを選択してください');
        setIsSubmitting(false);
        return;
      }
      const coords = await geocodeAddress(selectedStaff.baseLocation);
      const currentUser = await api.getCurrentUser();
      if (!currentUser) {
        alert('ログインが必要です');
        setIsSubmitting(false);
        return;
      }
      
      // selectedDates (YYYY-MM-DD) をソートしてカンマ区切りに変換（表示時にformatJobDatesがM/D表記へ変換する）
      const formattedDates = [...formData.selectedDates].sort().join(', ');

      const newTalent: Omit<Talent, 'id'> = {
        name: selectedStaff.name,
        maskedName: selectedStaff.maskedName,
        companyName: currentUser.name, 
        description: selectedStaff.prText || '',
        price: talentPrice,
        locationName: selectedStaff.baseLocation, // Group by baseLocation
        baseLocation: selectedStaff.baseLocation,
        nearestStation: selectedStaff.nearestStation,
        preferredArea: selectedStaff.preferredArea, 
        lat: coords.lat,
        lng: coords.lng,
        userId: currentUser.id,
        skills: selectedStaff.skills,
        carriers: selectedStaff.carriers,
        experience: selectedStaff.experience,
        prText: selectedStaff.prText,
        availableDates: formattedDates,
        completedTrainings: selectedStaff.completedTrainings || []
      };
      const savedTalent = await api.addTalent(newTalent);
      setTalents(prev => [...prev, savedTalent]);
      setTalentPrice(15000);
    }
    
    setIsSubmitting(false);
    setIsCreateFormOpen(false);
    alert(`${createFormType === 'job' ? '案件' : '人材'}を登録しました`);
  };

  // 初回データフェッチとマップ初期化
  useEffect(() => {
    const mapContainer = document.getElementById('map-area');
    if (!mapContainer || mapRef.current) return;

    const defaultLocation = { lat: 35.6812, lng: 139.7671 };

    setOptions({
      key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
      v: 'weekly'
    });

    let initObserver: ResizeObserver | null = null;
    let isCleanedUp = false;
    let currentLocMarker: any = null;

    const initMap = async () => {
      try {
        const { Map, InfoWindow } = await importLibrary('maps') as any;
        const { AdvancedMarkerElement } = await importLibrary('marker') as any;
        await importLibrary('places');

        if (isCleanedUp || !mapContainer) return;

        advancedMarkerClassRef.current = AdvancedMarkerElement;
        infoWindowClassRef.current = InfoWindow;

        const map = new Map(mapContainer, {
          center: defaultLocation,
          zoom: 14,
          mapId: import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID',
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: 9, // google.maps.ControlPosition.RIGHT_BOTTOM is 9
          },
        });

        mapRef.current = map;
        setIsMapLoaded(true);

        map.addListener('zoom_changed', () => {
          setMapZoom(map.getZoom());
        });

        map.addListener('click', () => {
          setSelectedMapJobs(null);
          setSelectedMapTalents(null);
        });

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              if (isCleanedUp || !mapRef.current) return;
              const lat = position.coords.latitude;
              const lng = position.coords.longitude;
              const currentLocation = { lat, lng };

              mapRef.current.setCenter(currentLocation);

              const currentLocPin = document.createElement('div');
              currentLocPin.innerHTML = `<div style="
                width: 16px;
                height: 16px;
                background-color: #2563EB;
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 0 10px rgba(0,0,0,0.3);
              "></div>`;

              const marker = new AdvancedMarkerElement({
                map: mapRef.current,
                position: currentLocation,
                content: currentLocPin,
                title: '現在地',
              });
              currentLocMarker = marker;

              const infoWindow = new InfoWindow({
                content: '<b>現在地</b>'
              });

              marker.addListener('gmp-click', () => {
                infoWindow.open({
                  anchor: marker,
                  map: mapRef.current,
                });
              });
            },
            (error) => {
              console.warn('位置情報の取得に失敗しました:', error.message);
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
          );
        }

      } catch (err: any) {
        console.error('Google Maps APIの読み込みに失敗しました:', err);
      }
    };

    // コンテナサイズが0の場合は、サイズが付与されるまで待機する
    if (mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) {
      initObserver = new ResizeObserver(() => {
        if (mapContainer.clientWidth > 0 && mapContainer.clientHeight > 0) {
          if (initObserver) {
            initObserver.disconnect();
          }
          if (!isCleanedUp && !mapRef.current) {
            initMap();
          }
        }
      });
      initObserver.observe(mapContainer);
    } else {
      initMap();
    }

    const loadData = async () => {
      try {
        const [fetchedJobs, fetchedTalents, fetchedTrainings, user, users, fetchedContractTasks] = await Promise.all([
          api.getJobs(),
          api.getTalents(),
          api.getTrainings(),
          api.getCurrentUser(),
          api.getUsers(),
          api.getContractTasks()
        ]);
        setJobs(fetchedJobs);
        setTalents(fetchedTalents);
        setAllTrainings(fetchedTrainings);
        setCurrentUser(user);
        setAllUsers(users);
        setContractTasks(fetchedContractTasks);
        
        if (user && users.length > 0) {
          const otherUsers = users.filter(u => u.id !== user.id);
          if (otherUsers.length > 0) {
            setTargetCompanyId(otherUsers[0].id);
          }
        }
      } catch (error) {
        console.error('データの取得に失敗しました', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();

    return () => {
      isCleanedUp = true;
      if (initObserver) {
        initObserver.disconnect();
      }
      if (currentLocMarker) {
        if ((window as any).google?.maps?.event) {
          (window as any).google.maps.event.clearInstanceListeners(currentLocMarker);
        }
        currentLocMarker.map = null;
      }
      if (mapRef.current) {
        mapRef.current = null;
      }
    };
  }, []);

  const startMapSelection = () => {
    if (tempMarkerRef.current) {
      tempMarkerRef.current.map = null;
      tempMarkerRef.current = null;
    }
    setIsCreateFormOpen(false);
    setIsSelectingLocationOnMap(true);
  };

  const cancelMapSelection = () => {
    setIsSelectingLocationOnMap(false);
    if (tempMarkerRef.current) {
      tempMarkerRef.current.map = null;
      tempMarkerRef.current = null;
    }
    setIsCreateFormOpen(true);
  };

  useEffect(() => {
    if (!mapRef.current) return;

    let clickListener: any = null;

    const handleMapClick = async (e: any) => {
      if (!isSelectingLocationOnMap || !mapRef.current || !e.latLng) return;

      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      if (tempMarkerRef.current) {
        tempMarkerRef.current.map = null;
      }

      if (advancedMarkerClassRef.current) {
        const AdvancedMarkerElement = advancedMarkerClassRef.current;
        const tempPin = document.createElement('div');
        tempPin.className = 'temp-location-marker';
        tempPin.innerHTML = `<div style="
          width: 20px;
          height: 20px;
          background-color: #EF4444;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
        "></div>`;

        tempMarkerRef.current = new AdvancedMarkerElement({
          map: mapRef.current,
          position: { lat, lng },
          content: tempPin,
        });
      }

      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja`);
        const data = await response.json();
        
        let addressText = '';
        if (data && data.display_name) {
          const parts = data.display_name.split(', ').reverse();
          addressText = parts.filter((p: string) => p !== '日本' && !p.match(/^\d{3}-\d{4}$/)).join('');
        }
        
        if (!addressText) {
          addressText = data?.display_name || `ピンを指定した地点 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        }

        // Populate exactLocation with the full address, and auto-generate locationName
        setFormData(prev => ({ 
          ...prev, 
          exactLocation: addressText,
          locationName: generateMaskedLocation(addressText, addressText, prev.salesChannel, prev.carrier, prev.workLocation)
        }));
        setTempSelectedLocation({ lat, lng });
        setMapSelectionKey(k => k + 1);
      } catch (err) {
        console.warn('逆ジオコーディングに失敗しました', err);
        const fallbackText = `ピンを指定した地点 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        setFormData(prev => ({ 
          ...prev, 
          exactLocation: fallbackText,
          locationName: generateMaskedLocation(fallbackText, fallbackText, prev.salesChannel, prev.carrier, prev.workLocation)
        }));
        setTempSelectedLocation({ lat, lng });
        setMapSelectionKey(k => k + 1);
      } finally {
        setIsSelectingLocationOnMap(false);
        setIsCreateFormOpen(true);
      }
    };

    if (isSelectingLocationOnMap) {
      clickListener = mapRef.current.addListener('click', handleMapClick);
      const mapDiv = document.getElementById('map-area');
      if (mapDiv) mapDiv.style.cursor = 'crosshair';
    }

    return () => {
      if (clickListener) {
        clickListener.remove();
      }
      const mapDiv = document.getElementById('map-area');
      if (mapDiv) mapDiv.style.cursor = '';
    };
  }, [isSelectingLocationOnMap]);

  const latestJobsRef = useRef(jobs);
  const latestTalentsRef = useRef(talents);
  const latestUserRef = useRef(currentUser);

  useEffect(() => { latestJobsRef.current = jobs; }, [jobs]);
  useEffect(() => { latestTalentsRef.current = talents; }, [talents]);
  useEffect(() => { latestUserRef.current = currentUser; }, [currentUser]);

  // talentsやjobsが更新されたときにドキュメントレベルのイベントリスナーを設定
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.classList.contains('view-profile-btn')) {
        const talentId = target.getAttribute('data-id');
        const talent = latestTalentsRef.current.find(t => t.id === talentId);
        if (talent) setSelectedTalent(talent);
      } else if (target && target.classList.contains('view-job-btn')) {
        const jobId = target.getAttribute('data-id');
        const job = latestJobsRef.current.find(j => j.id === jobId);
        if (job) {
          if (latestUserRef.current?.status === 'pending') {
            alert('本人確認書類（登記簿等）の審査中です。\\n審査完了後に詳細情報が閲覧可能になります。');
            return;
          }
          setSelectedJob(job);
        }
      } else if (target && target.classList.contains('view-area-btn')) {
        const areaName = target.getAttribute('data-area');
        if (areaName) {
          if (areaName.includes('渋谷')) setFilterArea('shibuya');
          else if (areaName.includes('新宿')) setFilterArea('shinjuku');
          else if (areaName.includes('池袋') || areaName.includes('豊島')) setFilterArea('ikebukuro');
          else setFilterArea('all');
          setViewMode('list');
        }
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  // 人材をフィルタリング＆ソートする
  const filteredTalents = useMemo(() => {
    let list = talents.filter(talent => {
      // 1. スキル（職種）フィルター
      if (filterTalentSkills.length > 0 && !talent.skills.some(s => filterTalentSkills.includes(s))) {
        return false;
      }
      // 2. 対応キャリア
      if (filterTalentCarriers.length > 0 && !talent.carriers?.some(c => filterTalentCarriers.includes(c))) {
        return false;
      }
      // 3. 受講済み研修
      if (filterTalentTrainings.length > 0 && !(talent.completedTrainings && filterTalentTrainings.every(tid => talent.completedTrainings?.includes(tid)))) {
        return false;
      }
      // 3.1 都道府県(拠点)
      if (!matchesPrefectureFilter(filterPrefectures, talent.baseLocation || talent.locationName)) {
        return false;
      }
      // 3.2 最低経験年数
      if (filterMinExperience > 0 && parseExperienceYears(talent.experience) < filterMinExperience) {
        return false;
      }
      // 4. キーワード検索
      if (searchKeyword.trim() !== '') {
        const kw = searchKeyword.toLowerCase();
        const nameMatch = talent.name?.toLowerCase().includes(kw) || talent.maskedName?.toLowerCase().includes(kw);
        const companyMatch = talent.companyName?.toLowerCase().includes(kw);
        const descMatch = talent.description?.toLowerCase().includes(kw) || talent.prText?.toLowerCase().includes(kw);
        const locMatch = talent.locationName?.toLowerCase().includes(kw) || talent.baseLocation?.toLowerCase().includes(kw);
        if (!nameMatch && !companyMatch && !descMatch && !locMatch) {
          return false;
        }
      }
      
      // 5. お気に入りフィルター
      if (showFavoritesOnly && currentUser) {
        if (!currentUser.favoriteTalentIds?.includes(talent.id)) {
          return false;
        }
      }
      
      return true;
    });

    // ソート処理
    const distFor = (t: Talent) =>
      userLocation && typeof t.lat === 'number' && typeof t.lng === 'number' && t.lat && t.lng
        ? distanceKm(userLocation.lat, userLocation.lng, t.lat, t.lng)
        : Number.POSITIVE_INFINITY;
    list.sort((a, b) => {
      switch (talentSortOrder) {
        case 'priceHigh': return b.price - a.price;
        case 'expLong': return parseExperienceYears(b.experience) - parseExperienceYears(a.experience);
        case 'trainingsMany': return countRealTrainings(b.completedTrainings) - countRealTrainings(a.completedTrainings);
        case 'nearest': return distFor(a) - distFor(b);
        case 'priceLow':
        default: return a.price - b.price;
      }
    });

    return list;
  }, [talents, filterTalentSkills, filterTalentCarriers, filterTalentTrainings, filterPrefectures, filterMinExperience, talentSortOrder, searchKeyword, showFavoritesOnly, currentUser, userLocation]);

  // 人材を「市町村・区」エリア単位にグループ化し、正確な位置を丸める（プライバシー保護）
  const groupedTalents = useMemo(() => {
    const groups: Record<string, { locationName: string, lat: number, lng: number, talents: Talent[] }> = {};
    filteredTalents.forEach(talent => {
      const areaKey = extractArea(talent.locationName || '');
      
      if (!groups[areaKey]) {
        // 座標を約1.1km単位のグリッドに丸めて代表地点とする
        const obfLat = Math.round(talent.lat * 100) / 100;
        const obfLng = Math.round(talent.lng * 100) / 100;
        groups[areaKey] = {
          locationName: areaKey,
          lat: obfLat,
          lng: obfLng,
          talents: []
        };
      }
      groups[areaKey].talents.push(talent);
    });
    return Object.values(groups);
  }, [filteredTalents]);


  const appliedJobIds = useMemo(() => {
    if (!currentUser) return [];
    
    // Find all chat tasks involving the current user's company
    const myChatTasks = contractTasks.filter(t => {
      if (!t.id.startsWith('chat_')) return false;
      const parts = t.id.split('_');
      return parts.includes(currentUser.id);
    });
    
    const ids: string[] = [];
    myChatTasks.forEach(t => {
      ids.push(...getLinkedJobIds(t.evaluations));
    });
    return ids;
  }, [contractTasks, currentUser]);

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      // 0. 自分または自社の人間が応募した案件、および自社案件は表示しない
      if (currentUser) {
        if (job.authorId === currentUser.id) return false;
        if (appliedJobIds.includes(job.id)) return false;
      }

      // 0.1 契約確定済みの案件（statusが 'confirmed', 'report_pending', 'completed', 'disputed' などのタスクが存在する案件）は非表示にする
      const isContracted = contractTasks.some(t => t.jobId === job.id && ['confirmed', 'report_pending', 'completed', 'disputed'].includes(t.status));
      if (isContracted) return false;

      // 1. エリアフィルタ(中心点からの半径。座標が無ければ地名一致にフォールバック)
      const matchesArea = isWithinAreaFilter(filterArea, { lat: job.lat, lng: job.lng, locationName: job.locationName });

      // 2. 限定公開フィルタ
      const matchesLimited = currentUser
        ? (!job.allowedCompanyIds || job.allowedCompanyIds.length === 0 ||
           job.allowedCompanyIds.includes(currentUser.id) || 
           job.authorId === currentUser.id)
        : true;

      // 4. 職種フィルター
      if (filterJobRoles.length > 0 && !filterJobRoles.includes(job.roleType || '')) {
        return false;
      }

      // 5. 対象キャリア
      if (filterCarriers.length > 0 && !filterCarriers.includes(job.carrier || '')) {
        return false;
      }

      // 6. 販路（店舗種別）
      if (filterChannels.length > 0 && !filterChannels.includes(job.salesChannel || '')) {
        return false;
      }

      // 6.1 都道府県
      if (!matchesPrefectureFilter(filterPrefectures, job.locationName)) {
        return false;
      }

      // 6.2 諸経費あり
      if (filterHasExpenses) {
        const ex = job.expenses;
        const hasExpenses = !!ex && (ex.transportType !== 'none' || ex.accommodationType !== 'none');
        if (!hasExpenses) return false;
      }

      // 7. 単価(下限・上限)
      if (job.price < filterMinPrice) {
        return false;
      }
      if (filterMaxPrice < PRICE_SLIDER_MAX && job.price > filterMaxPrice) {
        return false;
      }

      // 8. 締切フィルター＆期限切れ非表示
      let remainingDays = 999;
      if (job.applicationDeadline) {
        const dl = new Date(job.applicationDeadline.replace(/\//g, '-'));
        if (!isNaN(dl.getTime())) {
          const today = new Date();
          dl.setHours(0, 0, 0, 0);
          today.setHours(0, 0, 0, 0);
          remainingDays = Math.ceil((dl.getTime() - today.getTime()) / (1000 * 3600 * 24));
        }
      }

      if (remainingDays < 0) {
        return false; // 締切過ぎの案件は表示しない
      }

      if (filterDeadlineDays !== null && remainingDays > filterDeadlineDays) {
        return false;
      }

      // 9. キーワード検索
      if (searchKeyword.trim() !== '') {
        const kw = searchKeyword.toLowerCase();
        const titleMatch = job.title?.toLowerCase().includes(kw);
        const descMatch = job.description?.toLowerCase().includes(kw) || job.detailedDescription?.toLowerCase().includes(kw);
        const locMatch = job.locationName?.toLowerCase().includes(kw);
        if (!titleMatch && !descMatch && !locMatch) {
          return false;
        }
      }

      // 10. お気に入りフィルター
      if (showFavoritesOnly && currentUser) {
        if (!currentUser.favoriteJobIds?.includes(job.id)) {
          return false;
        }
      }

      return matchesArea && matchesLimited;
    });
  }, [jobs, filterArea, currentUser, filterJobRoles, filterCarriers, filterChannels, filterMinPrice, filterMaxPrice, filterDeadlineDays, filterPrefectures, filterHasExpenses, searchKeyword, appliedJobIds, showFavoritesOnly]);

  const sortedJobs = useMemo(() => {
    let list = [...filteredJobs];
    const deadlineOf = (j: Job) => {
      const t = j.applicationDeadline ? new Date(j.applicationDeadline.replace(/\//g, '-')).getTime() : NaN;
      return isNaN(t) ? Number.POSITIVE_INFINITY : t;
    };
    const distOf = (j: Job) => {
      const lat = j.exactLat ?? j.lat;
      const lng = j.exactLng ?? j.lng;
      return userLocation && typeof lat === 'number' && typeof lng === 'number' && lat && lng
        ? distanceKm(userLocation.lat, userLocation.lng, lat, lng)
        : Number.POSITIVE_INFINITY;
    };
    if (jobSortOrder === 'priceHigh') {
      list.sort((a, b) => b.price - a.price);
    } else if (jobSortOrder === 'priceLow') {
      list.sort((a, b) => a.price - b.price);
    } else if (jobSortOrder === 'deadlineNear') {
      list.sort((a, b) => deadlineOf(a) - deadlineOf(b));
    } else if (jobSortOrder === 'dateNear') {
      list.sort((a, b) => {
        const dateA = a.eventDate || '9999-12-31';
        const dateB = b.eventDate || '9999-12-31';
        return dateA.localeCompare(dateB);
      });
    } else if (jobSortOrder === 'nearest') {
      list.sort((a, b) => distOf(a) - distOf(b));
    } else {
      // 'newest' (新着順：モックのため配列の逆順)
      list.reverse();
    }

    // 緊急案件は並び順にかかわらず常に最上部へ。
    const urgents = list.filter(j => j.isUrgent);
    const normals = list.filter(j => !j.isUrgent);
    return [...urgents, ...normals];
  }, [filteredJobs, jobSortOrder, userLocation]);

  const filteredTalentGroups = useMemo(() => {
    return groupedTalents.filter(group =>
      isWithinAreaFilter(filterArea, { lat: group.lat, lng: group.lng, locationName: group.locationName }),
    );
  }, [groupedTalents, filterArea]);

  // 案件を「市町村・区」エリア単位にグループ化し、正確な位置を丸める（プライバシー保護）
  const groupedJobs = useMemo(() => {
    const groups: Record<string, { lat: number, lng: number, jobs: Job[], hasUrgent: boolean }> = {};
    filteredJobs.forEach(job => {
      const areaKey = extractArea(job.locationName || '');
      
      if (!groups[areaKey]) {
        // 座標を約1.1km単位のグリッドに丸めて代表地点とする
        const obfLat = Math.round(job.lat * 100) / 100;
        const obfLng = Math.round(job.lng * 100) / 100;
        groups[areaKey] = {
          lat: obfLat,
          lng: obfLng,
          jobs: [],
          hasUrgent: false
        };
      }
      groups[areaKey].jobs.push(job);
      if (job.isUrgent) {
        groups[areaKey].hasUrgent = true;
      }
    });
    return Object.values(groups);
  }, [filteredJobs]);

  const gridSize = useMemo(() => {
    const roundedZoom = Math.floor(mapZoom);
    if (roundedZoom >= 15) return 0;
    if (roundedZoom === 14) return 0.002;
    if (roundedZoom === 13) return 0.005;
    if (roundedZoom === 12) return 0.01;
    if (roundedZoom === 11) return 0.025;
    if (roundedZoom === 10) return 0.05;
    if (roundedZoom === 9) return 0.1;
    if (roundedZoom === 8) return 0.2;
    return 0.4;
  }, [mapZoom]);

  const clusteredJobs = useMemo(() => {
    if (gridSize === 0) return groupedJobs;
    const clusters: typeof groupedJobs = [];
    groupedJobs.forEach(group => {
      let found = false;
      for (const cluster of clusters) {
        const latDiff = Math.abs(cluster.lat - group.lat);
        const lngDiff = Math.abs(cluster.lng - group.lng);
        if (latDiff < gridSize && lngDiff < gridSize) {
          cluster.jobs = [...cluster.jobs, ...group.jobs];
          cluster.hasUrgent = cluster.hasUrgent || group.hasUrgent;
          const totalJobs = cluster.jobs.length;
          const newJobs = group.jobs.length;
          cluster.lat = (cluster.lat * (totalJobs - newJobs) + group.lat * newJobs) / totalJobs;
          cluster.lng = (cluster.lng * (totalJobs - newJobs) + group.lng * newJobs) / totalJobs;
          found = true;
          break;
        }
      }
      if (!found) {
        clusters.push({
          lat: group.lat,
          lng: group.lng,
          jobs: [...group.jobs],
          hasUrgent: group.hasUrgent
        });
      }
    });
    return clusters;
  }, [groupedJobs, gridSize]);

  const clusteredTalents = useMemo(() => {
    if (gridSize === 0) return filteredTalentGroups;
    const clusters: typeof filteredTalentGroups = [];
    filteredTalentGroups.forEach(group => {
      let found = false;
      for (const cluster of clusters) {
        const latDiff = Math.abs(cluster.lat - group.lat);
        const lngDiff = Math.abs(cluster.lng - group.lng);
        if (latDiff < gridSize && lngDiff < gridSize) {
          cluster.talents = [...cluster.talents, ...group.talents];
          const totalTalents = cluster.talents.length;
          const newTalents = group.talents.length;
          cluster.lat = (cluster.lat * (totalTalents - newTalents) + group.lat * newTalents) / totalTalents;
          cluster.lng = (cluster.lng * (totalTalents - newTalents) + group.lng * newTalents) / totalTalents;
          found = true;
          break;
        }
      }
      if (!found) {
        clusters.push({
          lat: group.lat,
          lng: group.lng,
          talents: [...group.talents],
          locationName: group.locationName
        });
      }
    });
    return clusters;
  }, [filteredTalentGroups, gridSize]);

  // mode と data の変更を検知してマップのピンを出し分ける
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || !advancedMarkerClassRef.current || !infoWindowClassRef.current) return;

    // Clear existing markers
    markersRef.current.forEach((m) => {
      if ((window as any).google?.maps?.event) {
        (window as any).google.maps.event.clearInstanceListeners(m);
      }
      m.map = null;
    });
    markersRef.current = [];

    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }

    const AdvancedMarkerElement = advancedMarkerClassRef.current;
    const newMarkers: any[] = [];
    // 100件以上は「99+」表記
    const fmtCount = (n: number) => (n > 99 ? '99+' : String(n));

    if (mode === 'job') {
      clusteredJobs.forEach((group) => {
        const isCluster = group.jobs.length > 1 && gridSize > 0;

        // バッジの色・サイズは拡大/縮小で統一(常に濃色・同サイズ)。
        const circleColor = group.hasUrgent ? '#B91C1C' : '#1E3A8A';
        const shadow = group.hasUrgent ? 'rgba(185, 28, 28, 0.5)' : 'rgba(30, 58, 138, 0.5)';
        const border = '3px solid #FFFFFF';
        const size = 40;
        const fontSize = 15;

        const pinElement = document.createElement('div');
        pinElement.style.cursor = 'pointer';
        pinElement.innerHTML = `
          <div style="
            width: ${size}px;
            height: ${size}px;
            background-color: ${circleColor};
            border: ${border};
            border-radius: 50%;
            box-shadow: 0 4px 6px ${shadow};
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: ${fontSize}px;
            transition: transform 0.15s ease;
          ">
            ${fmtCount(group.jobs.length)}
          </div>
        `;

        pinElement.addEventListener('mouseenter', () => {
          const inner = pinElement.firstElementChild as HTMLElement;
          if (inner) inner.style.transform = 'scale(1.1)';
        });
        pinElement.addEventListener('mouseleave', () => {
          const inner = pinElement.firstElementChild as HTMLElement;
          if (inner) inner.style.transform = 'scale(1)';
        });

        const marker = new AdvancedMarkerElement({
          position: { lat: group.lat, lng: group.lng },
          map: mapRef.current,
          content: pinElement,
          title: isCluster ? `案件クラスター: ${group.jobs.length}件` : `案件: ${group.jobs.length}件`,
        });
        (marker as any).__count = group.jobs.length;
        (marker as any).__hasUrgent = group.hasUrgent;

        marker.addListener('gmp-click', () => {
          if (isCluster) {
            mapRef.current.setZoom(mapRef.current.getZoom() + 2);
            mapRef.current.panTo({ lat: group.lat, lng: group.lng });
          }
          setSelectedMapJobs(group.jobs);
          setSelectedMapTalents(null);
        });

        newMarkers.push(marker);
      });
    } else {
      clusteredTalents.forEach((group) => {
        const isCluster = group.talents.length > 1 && gridSize > 0;

        // バッジの色・サイズは拡大/縮小で統一(常に濃色・同サイズ)。
        const circleColor = '#065F46';
        const shadow = 'rgba(6, 95, 70, 0.5)';
        const border = '3px solid #FFFFFF';
        const size = 40;
        const fontSize = 15;

        const pinElement = document.createElement('div');
        pinElement.style.cursor = 'pointer';
        pinElement.innerHTML = `
          <div style="
            width: ${size}px;
            height: ${size}px;
            background-color: ${circleColor};
            border: ${border};
            border-radius: 50%;
            box-shadow: 0 4px 6px ${shadow};
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: ${fontSize}px;
            transition: transform 0.15s ease;
          ">
            ${fmtCount(group.talents.length)}
          </div>
        `;

        pinElement.addEventListener('mouseenter', () => {
          const inner = pinElement.firstElementChild as HTMLElement;
          if (inner) inner.style.transform = 'scale(1.1)';
        });
        pinElement.addEventListener('mouseleave', () => {
          const inner = pinElement.firstElementChild as HTMLElement;
          if (inner) inner.style.transform = 'scale(1)';
        });

        const marker = new AdvancedMarkerElement({
          position: { lat: group.lat, lng: group.lng },
          map: mapRef.current,
          content: pinElement,
          title: isCluster ? `人材クラスター: ${group.talents.length}名` : `人材: ${group.talents.length}名`,
        });
        (marker as any).__count = group.talents.length;

        marker.addListener('gmp-click', () => {
          if (isCluster) {
            mapRef.current.setZoom(mapRef.current.getZoom() + 2);
            mapRef.current.panTo({ lat: group.lat, lng: group.lng });
          }
          setSelectedMapTalents({ locationName: group.locationName || '複数エリア', talents: group.talents });
          setSelectedMapJobs(null);
        });

        newMarkers.push(marker);
      });
    }

    markersRef.current = newMarkers;

    if (mapRef.current && newMarkers.length > 0) {
      try {
        const isTalent = mode !== 'job';
        // ライブラリ既定の濃い青グラデーションバッジは使わず、
        // 案件/人材の合計数を表示するフラットな円バッジに差し替える。
        const clusterRenderer = {
          render: ({ markers, position }: any) => {
            const total = (markers || []).reduce(
              (sum: number, mk: any) => sum + (mk.__count || 1),
              0
            );
            const hasUrgent = !isTalent && (markers || []).some((mk: any) => mk.__hasUrgent);
            const color = isTalent ? '#065F46' : hasUrgent ? '#B91C1C' : '#1E3A8A';
            const shadow = isTalent
              ? 'rgba(6, 95, 70, 0.5)'
              : hasUrgent
              ? 'rgba(185, 28, 28, 0.5)'
              : 'rgba(30, 58, 138, 0.5)';
            const label = fmtCount(total);
            const el = document.createElement('div');
            el.style.cursor = 'pointer';
            el.innerHTML = `
              <div style="
                width: 40px;
                height: 40px;
                background-color: ${color};
                border: 3px solid #FFFFFF;
                border-radius: 50%;
                box-shadow: 0 4px 6px ${shadow};
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: ${label.length >= 3 ? 13 : 15}px;
              ">${label}</div>
            `;
            return new AdvancedMarkerElement({ position, content: el });
          },
        };
        clustererRef.current = new MarkerClusterer({
          map: mapRef.current,
          markers: newMarkers,
          renderer: clusterRenderer,
        });
      } catch (e) {
        console.warn('MarkerClusterer init warning:', e);
      }
    }

  }, [isMapLoaded, mode, clusteredJobs, clusteredTalents, mapZoom, gridSize]);


  const activeFiltersCount = useMemo(() => {
    let count = 0;
    count += filterPrefectures.length;
    if (mode === 'job') {
      count += filterJobRoles.length;
      count += filterCarriers.length;
      count += filterChannels.length;
      if (filterMinPrice > 0 || filterMaxPrice < PRICE_SLIDER_MAX) count += 1;
      if (filterDeadlineDays !== null) count += 1;
      if (filterHasExpenses) count += 1;
      if (searchKeyword.trim() !== '') count += 1;
    } else {
      count += filterTalentSkills.length;
      count += filterTalentCarriers.length;
      count += filterTalentTrainings.length;
      if (filterMinExperience > 0) count += 1;
      if (searchKeyword.trim() !== '') count += 1;
    }
    if (showFavoritesOnly) count += 1;
    return count;
  }, [mode, filterPrefectures, filterJobRoles, filterCarriers, filterChannels, filterMinPrice, filterMaxPrice, filterDeadlineDays, filterHasExpenses, filterTalentSkills, filterTalentCarriers, filterTalentTrainings, filterMinExperience, showFavoritesOnly, searchKeyword]);

  const hasActiveFilters = useMemo(() => {
    if (mode === 'job') {
      return jobSortOrder !== 'newest' || activeFiltersCount > 0;
    } else {
      return talentSortOrder !== 'priceLow' || activeFiltersCount > 0;
    }
  }, [mode, jobSortOrder, talentSortOrder, activeFiltersCount]);

  const clearAllFilters = () => {
    setSearchKeyword('');
    setFilterPrefectures([]);
    setShowFavoritesOnly(false);
    if (mode === 'job') {
      setJobSortOrder('newest');
      setFilterJobRoles([]);
      setFilterCarriers([]);
      setFilterChannels([]);
      setFilterMinPrice(0);
      setFilterMaxPrice(PRICE_SLIDER_MAX);
      setFilterDeadlineDays(null);
      setFilterHasExpenses(false);
    } else {
      setTalentSortOrder('priceLow');
      setFilterTalentSkills([]);
      setFilterTalentCarriers([]);
      setFilterTalentTrainings([]);
      setFilterMinExperience(0);
    }
  };

  const resultCount = mode === 'job' ? sortedJobs.length : filteredTalents.length;


  const handleJobApplication = async () => {
    if (!currentUser || !selectedJob) return;
    
    const sortedIds = [currentUser.id, selectedJob.authorId].sort();
    const roomId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
    
    try {
      const tasks = await api.getContractTasks();
      const existingTask = tasks.find(t => t.id === roomId);
      let msgs = [];
      
      if (existingTask) {
        msgs = (existingTask.evaluations as any)?.messages || [];
      } else {
        const defaultRoomMessages: any[] = [
          { id: 'sys_init', type: 'system', text: 'チャットを開始しました', time: '' }
        ];
        if (roomId === 'chat_alpha_sigma') {
          defaultRoomMessages.push(
            { id: 'def_12', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信', text: 'お世話になっております。週末のキャンペーンスタッフ2名の件ですが、まだ募集されていますでしょうか？', time: '10:30', avatar: 'A' },
            { id: 'def_13', type: 'sent', senderId: currentUser.id === 'alpha' ? 'sigma' : 'alpha', text: 'お世話になっております！はい、まだ募集しております。\n単価15,000円でお願いしたいのですが、いかがでしょうか？', time: '10:35' },
            { id: 'def_14', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信', text: '明日の待ち合わせ時間は10時でお願いします。', time: '10:42', avatar: 'A' }
          );
        } else if (roomId === 'chat_beta_sigma') {
          defaultRoomMessages.push(
            { id: 'def_22', type: 'received', senderId: 'beta', senderName: 'ベータエージェンシー', text: '発注書を発行しました。ご確認お願いします。', time: '昨日', avatar: 'B' }
          );
        } else if (roomId === 'chat_gamma_sigma') {
          defaultRoomMessages.push(
            { id: 'def_32', type: 'received', senderId: 'gamma', senderName: 'ガンマモバイル', text: 'よろしくお願いします。', time: '月曜日', avatar: 'G' }
          );
        }
        msgs = defaultRoomMessages;
      }
      
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      let finalStaffId = selectedStaffId;
      if (!finalStaffId && currentUser) {
        // Create a default staff for this company as a fallback
        const newStaff = await api.addStaff({
          userId: currentUser.id,
          name: `${currentUser.name} スタッフA`,
          maskedName: `${currentUser.name.substring(0, 4)}*`,
          baseLocation: '東京都新宿区',
          nearestStation: '新宿駅',
          preferredArea: '東京都',
          price: 15000,
          skills: ['キャンペーンクルー'],
          carriers: ['docomo', 'au/UQmobile']
        });
        finalStaffId = newStaff.id;
        // Seed logs for this new staff member as well!
        await api.seedStaffAttendanceLogs(); 
      }

      const selectedStaff = myStaffs.find(s => s.id === finalStaffId) || 
                            (await api.getStaffsByUserId(currentUser.id)).find(s => s.id === finalStaffId);

      const appMsg = {
        id: 'sys_app_' + Date.now(),
        type: 'system',
        text: `案件「${selectedJob.title}」に応募しました。\n【提案人材】: ${selectedStaff ? selectedStaff.name : '未選択'}`,
        time: timeStr
      };
      
      const updated = [...msgs, appMsg];
      
      const authorName = allUsers.find(u => u.id === selectedJob.authorId)?.name || 'パートナー企業';
      
      const appliedJobStaffIds = finalStaffId ? { [selectedJob.id]: finalStaffId } : undefined;
      
      await api.saveContractTaskChat(
        roomId,
        updated,
        selectedJob.title,
        authorName,
        currentUser.name,
        [selectedJob.id],
        appliedJobStaffIds
      );
      
      const refreshedTasks = await api.getContractTasks();
      setContractTasks(refreshedTasks);
      
      localStorage.setItem('connexy_active_chat_id', roomId);
      
      alert('応募が完了しました！チャット画面へ移動して担当者と連絡を取りましょう！');
      setIsNdaModalOpen(false);
      setNdaAgreed(false);
      setSelectedJob(null);
      navigate('/message');
    } catch (err) {
      console.error('Application failed:', err);
      alert('応募処理中にエラーが発生しました。');
    }
  };

  const handleStartTalentChat = async () => {
    if (!currentUser || !selectedTalent) return;
    
    if (currentUser.id === selectedTalent.userId) {
      alert('自社の人材にはメッセージを送信できません。');
      return;
    }
    
    const sortedIds = [currentUser.id, selectedTalent.userId].sort();
    const roomId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
    
    try {
      const tasks = await api.getContractTasks();
      const existingTask = tasks.find(t => t.id === roomId);
      let msgs = [];
      
      if (existingTask) {
        msgs = (existingTask.evaluations as any)?.messages || [];
      } else {
        const defaultRoomMessages: any[] = [
          { id: 'sys_init', type: 'system', text: 'チャットを開始しました', time: '' }
        ];
        if (roomId === 'chat_alpha_sigma') {
          defaultRoomMessages.push(
            { id: 'def_12', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信', text: 'お世話になっております。週末のキャンペーンスタッフ2名の件ですが、まだ募集されていますでしょうか？', time: '10:30', avatar: 'A' },
            { id: 'def_13', type: 'sent', senderId: currentUser.id === 'alpha' ? 'sigma' : 'alpha', text: 'お世話になっております！はい、まだ募集しております。\n単価15,000円でお願いしたいのですが、いかがでしょうか？', time: '10:35' },
            { id: 'def_14', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信', text: '明日の待ち合わせ時間は10時でお願いします。', time: '10:42', avatar: 'A' }
          );
        } else if (roomId === 'chat_beta_sigma') {
          defaultRoomMessages.push(
            { id: 'def_22', type: 'received', senderId: 'beta', senderName: 'ベータエージェンシー', text: '発注書を発行しました。ご確認お願いします。', time: '昨日', avatar: 'B' }
          );
        } else if (roomId === 'chat_gamma_sigma') {
          defaultRoomMessages.push(
            { id: 'def_32', type: 'received', senderId: 'gamma', senderName: 'ガンマモバイル', text: 'よろしくお願いします。', time: '月曜日', avatar: 'G' }
          );
        }
        msgs = defaultRoomMessages;
      }
      
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      const offerMsg = {
        id: 'sys_offer_' + Date.now(),
        type: 'system',
        text: `人材「${selectedTalent.maskedName}」についてのお問い合わせチャットが開始されました。`,
        time: timeStr
      };
      
      const updated = [...msgs, offerMsg];
      
      const clientName = currentUser.name;
      const workerName = selectedTalent.companyName || 'パートナー企業';
      const jobTitle = `${selectedTalent.maskedName}の採用オファー`;
      
      await api.saveContractTaskChat(roomId, updated, jobTitle, clientName, workerName);
      
      localStorage.setItem('connexy_active_chat_id', roomId);
      
      setSelectedTalent(null);
      navigate('/message');
    } catch (err) {
      console.error('Talent chat start failed:', err);
      alert('チャット開始処理中にエラーが発生しました。');
    }
  };

  return (
    <div className="view active" style={{ display: 'flex', flexDirection: 'column' }}>
      {isSelectingLocationOnMap && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(8px)',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '30px',
          zIndex: 4000,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.15)'
        }}>
          <span className="material-symbols-outlined" style={{ color: '#EF4444' }}>pin_drop</span>
          <span style={{ fontSize: '14px', fontWeight: 'bold' }}>地図上をクリックしてピンを立ててください</span>
          <button 
            type="button" 
            onClick={cancelMapSelection} 
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '16px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            キャンセル
          </button>
        </div>
      )}
      {!isSelectingLocationOnMap && (
      <header className="glass-header" style={{ zIndex: 1000, position: 'relative' }}>
        <div className="header-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ width: '40px' }}></div>
          <div className="toggle-switch">
            <input
              type="radio"
              id="mode-job"
              name="search-mode"
              checked={mode === 'job'}
              onChange={() => {
                setMode('job');
                setFilterArea('all');
              }}
            />
            <label htmlFor="mode-job">案件を探す</label>
            <input
              type="radio"
              id="mode-talent"
              name="search-mode"
              checked={mode === 'talent'}
              onChange={() => {
                setMode('talent');
                setFilterArea('all');
              }}
            />
            <label htmlFor="mode-talent">人材を探す</label>
            <div className="toggle-slider"></div>
          </div>
          <button 
            type="button" 
            className="icon-btn-dark" 
            onClick={() => window.dispatchEvent(new Event('open-settings-menu'))}
            style={{ padding: '4px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>menu</span>
          </button>
        </div>
        <div className="header-search" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {/* ビュー切り替えカプセルボタン */}
          <div style={{
            display: 'flex',
            background: '#F1F5F9',
            padding: '3px',
            borderRadius: '20px',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
            alignItems: 'center',
            flexShrink: 0
          }}>
            <button
              onClick={() => setViewMode('map')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 14px',
                borderRadius: '17px',
                border: 'none',
                background: viewMode === 'map' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'map' ? 'var(--primary)' : '#64748B',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: viewMode === 'map' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>map</span>
              マップ
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 14px',
                borderRadius: '17px',
                border: 'none',
                background: viewMode === 'list' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'list' ? 'var(--primary)' : '#64748B',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>format_list_bulleted</span>
              リスト
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>
            <button
              className="filter-btn"
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              style={{ 
                backgroundColor: showFavoritesOnly ? '#FEE2E2' : 'var(--surface-color)',
                color: showFavoritesOnly ? '#EF4444' : 'var(--text-main)',
                border: 'none',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                transition: 'all 0.2s ease',
                flexShrink: 0
              }}
              title="お気に入りのみ表示"
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: showFavoritesOnly ? "'FILL' 1" : "'FILL' 0" }}>
                favorite
              </span>
            </button>
            <button 
              className="filter-btn" 
              onClick={handleRefresh}
            style={{ 
              backgroundColor: 'var(--surface-color)',
              color: 'var(--text-main)',
              border: 'none',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
            title="データを更新"
          >
            <span className={`material-symbols-outlined ${isRefreshing ? 'spin-anim' : ''}`}>
              refresh
            </span>
          </button>
          <button 
            className="filter-btn" 
            onClick={() => setIsFilterSheetOpen(true)}
            style={{ 
              backgroundColor: hasActiveFilters ? 'var(--primary)' : 'white',
              color: hasActiveFilters ? 'white' : 'var(--text-main)',
              border: 'none',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transition: 'all 0.2s ease',
              flexShrink: 0,
              position: 'relative'
            }}
            title="詳細フィルター"
          >
            <span className="material-symbols-outlined">
              tune
            </span>
            {activeFiltersCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                background: '#EF4444',
                color: 'white',
                borderRadius: '50%',
                width: '16px',
                height: '16px',
                fontSize: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                border: '2px solid white'
              }}>
                {activeFiltersCount}
              </span>
            )}
          </button>
          </div>
        </div>
      </header>
      )}

      <div 
        className="map-area" 
        id="map-area" 
        style={{ display: viewMode === 'map' || isSelectingLocationOnMap ? 'block' : 'none', flex: 1, zIndex: 1, position: 'relative' }}
      ></div>

      {viewMode === 'list' && !isSelectingLocationOnMap && (
        <main 
          className="list-area bg-gray" 
          style={{ flex: 1, overflowY: 'auto', zIndex: 2, paddingBottom: '80px' }}
          onScroll={(e) => {
            const target = e.currentTarget;
            const total = mode === 'job' ? sortedJobs.length : filteredTalentGroups.length;
            if (visibleCount < total && target.scrollHeight - target.scrollTop - target.clientHeight < 200) {
              setVisibleCount(prev => prev + 10);
            }
          }}
        >
          <div style={{ padding: '16px', background: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {!hasActiveFilters ? (
                <span style={{ fontSize: '13px', color: 'var(--text-sub)' }}>フィルター未設定</span>
              ) : (
                <>
                  {filterPrefectures.map(pref => (
                    <div key={`pref-${pref}`} className="filter-chip">
                      <span>{pref}</span>
                      <button onClick={() => setFilterPrefectures(prev => prev.filter(x => x !== pref))}>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                      </button>
                    </div>
                  ))}
                  {showFavoritesOnly && (
                    <div className="filter-chip">
                      <span>お気に入りのみ</span>
                      <button onClick={() => setShowFavoritesOnly(false)}>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                      </button>
                    </div>
                  )}
                  {mode === 'job' ? (
                    <>
                      {searchKeyword.trim() !== '' && (
                        <div className="filter-chip">
                          <span>キーワード: "{searchKeyword}"</span>
                          <button onClick={() => setSearchKeyword('')}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      )}
                      {filterJobRoles.map(role => (
                        <div key={role} className="filter-chip">
                          <span>{role}</span>
                          <button onClick={() => setFilterJobRoles(prev => prev.filter(r => r !== role))}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      ))}
                      {filterCarriers.map(carrier => (
                        <div key={carrier} className="filter-chip">
                          <span>{carrier}</span>
                          <button onClick={() => setFilterCarriers(prev => prev.filter(c => c !== carrier))}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      ))}
                      {filterChannels.map(channel => (
                        <div key={channel} className="filter-chip">
                          <span>{channel}</span>
                          <button onClick={() => setFilterChannels(prev => prev.filter(c => c !== channel))}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      ))}
                      {(filterMinPrice > 0 || filterMaxPrice < PRICE_SLIDER_MAX) && (
                        <div className="filter-chip">
                          <span>
                            単価 ¥{filterMinPrice.toLocaleString()}〜{filterMaxPrice >= PRICE_SLIDER_MAX ? '' : `¥${filterMaxPrice.toLocaleString()}`}
                          </span>
                          <button onClick={() => { setFilterMinPrice(0); setFilterMaxPrice(PRICE_SLIDER_MAX); }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      )}
                      {filterDeadlineDays !== null && (
                        <div className="filter-chip">
                          <span>締切{filterDeadlineDays}日以内</span>
                          <button onClick={() => setFilterDeadlineDays(null)}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      )}
                      {filterHasExpenses && (
                        <div className="filter-chip">
                          <span>諸経費あり</span>
                          <button onClick={() => setFilterHasExpenses(false)}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {searchKeyword.trim() !== '' && (
                        <div className="filter-chip">
                          <span>キーワード: "{searchKeyword}"</span>
                          <button onClick={() => setSearchKeyword('')}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      )}
                      {filterTalentSkills.map(skill => (
                        <div key={skill} className="filter-chip">
                          <span>{skill}</span>
                          <button onClick={() => setFilterTalentSkills(prev => prev.filter(s => s !== skill))}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      ))}
                      {filterTalentCarriers.map(carrier => (
                        <div key={carrier} className="filter-chip">
                          <span>{carrier}</span>
                          <button onClick={() => setFilterTalentCarriers(prev => prev.filter(c => c !== carrier))}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      ))}
                      {filterTalentTrainings.map(tid => {
                        const tr = allTrainings.find(t => t.id === tid);
                        return (
                          <div key={tid} className="filter-chip">
                            <span>{tr?.title || '研修'}</span>
                            <button onClick={() => setFilterTalentTrainings(prev => prev.filter(t => t !== tid))}>
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                            </button>
                          </div>
                        );
                      })}
                      {filterMinExperience > 0 && (
                        <div className="filter-chip">
                          <span>経験{filterMinExperience}年以上</span>
                          <button onClick={() => setFilterMinExperience(0)}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  <button 
                    onClick={clearAllFilters}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      border: '1px solid #EF4444',
                      background: 'none',
                      color: '#EF4444',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    すべてクリア
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="skeleton" style={{ height: '24px', width: '70%' }}></div>
                  <div className="skeleton" style={{ height: '16px', width: '40%' }}></div>
                  <div className="skeleton" style={{ height: '16px', width: '50%' }}></div>
                  <div className="skeleton" style={{ height: '40px', width: '100%', marginTop: '8px' }}></div>
                </div>
              ))
            ) : mode === 'job' ? (
              sortedJobs.length > 0 ? (
                <>
                {sortedJobs.slice(0, visibleCount).map(job => {
                  let remainingDaysText = '';
                  let remainingDaysColor = '#059669';
                  let remainingDaysBg = '#ECFDF5';
                  if (job.applicationDeadline) {
                    const dl = new Date(job.applicationDeadline);
                    const today = new Date();
                    dl.setHours(0, 0, 0, 0);
                    today.setHours(0, 0, 0, 0);
                    const diff = Math.ceil((dl.getTime() - today.getTime()) / (1000 * 3600 * 24));
                    if (diff === 0) { remainingDaysText = '本日締切'; remainingDaysColor = '#DC2626'; remainingDaysBg = '#FEF2F2'; }
                    else if (diff <= 3) { remainingDaysText = `あと${diff}日`; remainingDaysColor = '#D97706'; remainingDaysBg = '#FFFBEB'; }
                    else if (diff <= 7) { remainingDaysText = `あと${diff}日`; }
                    else { remainingDaysText = '1週間以上'; }
                  }

                  return (
                  <div key={job.id} 
                    className={`job-card-modern ${job.isUrgent ? 'job-card-urgent' : ''}`}
                    onClick={() => {
                      if (currentUser?.status === 'pending') {
                        alert('本人確認書類（登記簿等）の審査中です。\n審査完了後に詳細情報が閲覧可能になります。');
                        return;
                      }
                      setSelectedJob(job);
                    }}
                  >
                    
                    {job.isUrgent && (
                      <div className="job-card-urgent-badge">
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>bolt</span>
                        緊急募集
                      </div>
                    )}

                    <div className="job-title-row">
                      <h3><span>{job.title}</span></h3>
                      {currentUser && (
                        <button
                          className="job-fav-btn"
                          onClick={(e) => handleToggleFavoriteJob(job.id, e)}
                          aria-label="お気に入り"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: currentUser.favoriteJobIds?.includes(job.id) ? '#EF4444' : '#CBD5E1', fontVariationSettings: currentUser.favoriteJobIds?.includes(job.id) ? "'FILL' 1" : "'FILL' 0" }}>
                            favorite
                          </span>
                        </button>
                      )}
                    </div>

                    <div className="job-meta-line">
                      <span className="job-meta-company">{allUsers.find(u => u.id === job.authorId)?.name || '掲載企業'}</span>
                      {job.locationName && (
                        <span className="job-meta-area">
                          <span className="material-symbols-outlined">location_on</span>{getCityArea(job.locationName) || job.locationName}
                        </span>
                      )}
                      {pastTradeCompanyIds.has(job.authorId) && (
                        <span className="job-trade-badge">
                          <span className="material-symbols-outlined">handshake</span>取引実績
                        </span>
                      )}
                    </div>

                    <div className="job-tags-container">
                      {job.carrier && <span className="modern-tag tag-carrier">{job.carrier}</span>}
                      {job.salesChannel && <span className="modern-tag tag-channel">{job.salesChannel}</span>}
                      {job.roleType && <span className="modern-tag tag-role">{job.roleType}</span>}
                    </div>

                    <div className="job-stat-line">
                      <span className="job-stat-when">
                        <span className="material-symbols-outlined">calendar_today</span>
                        {job.eventDate ? formatJobDates(job.eventDate) : '日程未定'}
                        {remainingDaysText && (
                          <span className="job-deadline-pill" style={{ color: remainingDaysColor, backgroundColor: remainingDaysBg }}>
                            {remainingDaysText === '本日締切' ? '本日締切' : `締切${remainingDaysText}`}
                          </span>
                        )}
                      </span>
                      <span className="job-price-inline">{renderJobPrice(job)}</span>
                    </div>
                  </div>
                )})}
                {sortedJobs.length > visibleCount && (
                  <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '12px', color: 'var(--text-sub)' }}>
                    スクロールしてさらに読み込み中 ({Math.min(visibleCount, sortedJobs.length)} / {sortedJobs.length}件)
                  </div>
                )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-sub)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '40px', marginBottom: '8px', opacity: 0.5 }}>search_off</span>
                  <p>該当する案件が見つかりません</p>
                </div>
              )
            ) : (
              filteredTalentGroups.length > 0 ? (
                <>
                {filteredTalentGroups.slice(0, visibleCount).map(group => (
                  <div key={group.locationName} style={{ background: 'var(--surface-color)', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', animation: 'fadeIn 0.3s ease', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', background: '#F9FAFB', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-main)' }}>{group.locationName}</h3>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#10B981', background: '#D1FAE5', padding: '4px 10px', borderRadius: '12px' }}>{group.talents.length}名</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {group.talents.map((talent) => (
                        <div key={talent.id} 
                          className="job-card-modern"
                          onClick={() => setSelectedTalent(talent)}
                          style={{ margin: '8px 16px', borderBottom: 'none' }}
                        >
                          <div className="job-title-row" style={{ paddingRight: '0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input 
                                type="checkbox" 
                                checked={selectedTalentIds.includes(talent.id)} 
                                onChange={(e) => handleToggleSelectTalent(talent.id, e as any)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#4F46E5' }} 
                              />
                              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#10B981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold' }}>
                                {talent.maskedName.charAt(0)}
                              </div>
                              <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '2px' }}>{talent.companyName}</div>
                                <h3 style={{ fontSize: '15px', color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {talent.maskedName}
                                  {talent.hasCertificate && (
                                    <span className="material-symbols-outlined" style={{ color: '#10B981', fontSize: '16px' }} title="運営確認済">verified</span>
                                  )}
                                </h3>
                              </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="status-badge badge-contracted" style={{ margin: 0, fontSize: '11px', background: '#D1FAE5', color: '#065F46', whiteSpace: 'nowrap' }}>稼働可能</span>
                                {currentUser && (
                                  <button
                                    onClick={(e) => handleToggleFavoriteTalent(talent.id, e)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: currentUser.favoriteTalentIds?.includes(talent.id) ? '#EF4444' : '#CBD5E1', fontVariationSettings: currentUser.favoriteTalentIds?.includes(talent.id) ? "'FILL' 1" : "'FILL' 0" }}>
                                      favorite
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>
                          
                          {talent.availableDates && (
                            <div className="job-location" style={{ color: 'var(--primary)', marginTop: '8px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>calendar_month</span>
                              希望勤務日: {formatJobDates(talent.availableDates)}
                            </div>
                          )}

                          <div className="job-tags-container" style={{ marginTop: '8px' }}>
                            {talent.carriers?.map(carrier => (
                              <span key={carrier} className="modern-tag tag-carrier">{carrier}</span>
                            ))}
                            {talent.skills.map(skill => (
                              <span key={skill} className="modern-tag tag-location">{skill}</span>
                            ))}
                          </div>
                          
                          <div className="job-stats-row">
                            <div className="job-stat-item">
                              <span className="job-stat-label">単価</span>
                              <span className="job-stat-value">
                                <span className="job-price" style={{ color: '#10B981' }}>¥{talent.price?.toLocaleString()}</span>
                                <span className="job-price-unit">/ 日〜</span>
                              </span>
                            </div>
                          </div>

                          <div className="job-card-arrow" style={{ color: '#10B981' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>arrow_forward</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredTalentGroups.length > visibleCount && (
                  <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '12px', color: 'var(--text-sub)' }}>
                    スクロールしてさらに読み込み中 ({Math.min(visibleCount, filteredTalentGroups.length)} / {filteredTalentGroups.length}エリア)
                  </div>
                )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-sub)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '40px', marginBottom: '8px', opacity: 0.5 }}>search_off</span>
                  <p>該当する人材が見つかりません</p>
                </div>
              )
            )}
          </div>
        </main>
      )}

      {/* 人材プロフィール オーバーレイ */}
      <div className={`overlay-view ${selectedTalent ? 'show' : ''}`} style={{ display: selectedTalent ? 'flex' : 'none', transform: selectedTalent ? 'translateX(0)' : 'translateX(100%)', zIndex: 2000 }}>
        <header className="solid-header overlay-header">
          <button className="icon-btn-dark" onClick={() => setSelectedTalent(null)}>
            <span className="material-symbols-outlined">arrow_back_ios_new</span>
          </button>
          <h1 style={{ fontSize: '16px' }}>{selectedTalent?.maskedName}の詳細</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            {currentUser && selectedTalent && (
              <button 
                className="icon-btn-dark"
                onClick={(e) => handleToggleFavoriteTalent(selectedTalent.id, e)}
                style={{ color: currentUser.favoriteTalentIds?.includes(selectedTalent.id) ? '#EF4444' : 'inherit' }}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: currentUser.favoriteTalentIds?.includes(selectedTalent.id) ? "'FILL' 1" : "'FILL' 0" }}>
                  favorite
                </span>
              </button>
            )}
            <button className="icon-btn-dark">
              <span className="material-symbols-outlined">more_vert</span>
            </button>
          </div>
        </header>

        <main className="list-area bg-gray" style={{ flex: 1, overflowY: 'auto', paddingBottom: '100px' }}>
          {selectedTalent && (
            <>
              {/* 基本情報 */}
              <div style={{ background: 'var(--surface-color)', padding: '24px 16px', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#10B981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 12px auto', fontWeight: 'bold' }}>
                  {selectedTalent.maskedName.charAt(0)}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-sub)', marginBottom: '4px' }}>{selectedTalent.companyName}</div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  {selectedTalent.maskedName}
                  {selectedTalent.hasCertificate && (
                    <span className="material-symbols-outlined" style={{ color: '#10B981', fontSize: '20px', verticalAlign: 'middle' }} title="運営確認済">verified</span>
                  )}
                </h2>
                {selectedTalentRating && selectedTalentRating.count > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '12px', fontSize: '14px' }}>
                    <span style={{ color: '#F59E0B' }}>★</span>
                    <strong style={{ color: '#111827' }}>{selectedTalentRating.average.toFixed(1)}</strong>
                    <span style={{ color: 'var(--text-sub)' }}>({selectedTalentRating.count}件の評価)</span>
                  </div>
                )}
                <span className="status-badge badge-contracted" style={{ display: 'inline-block', background: '#D1FAE5', color: '#065F46', marginBottom: '16px' }}>稼働可能</span>

                
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {selectedTalent.carriers?.map(carrier => (
                    <span key={carrier} style={{ fontSize: '12px', padding: '4px 10px', background: '#E0E7FF', color: '#4338CA', borderRadius: '4px', fontWeight: 'bold' }}>{carrier}</span>
                  ))}
                  {selectedTalent.skills.map(skill => (
                    <span key={skill} style={{ fontSize: '12px', padding: '4px 10px', background: '#F3F4F6', color: '#4B5563', borderRadius: '16px' }}>{skill}</span>
                  ))}
                </div>
              </div>

              {/* 希望勤務日 */}
              {selectedTalent.availableDates && (
                <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>calendar_month</span>
                    希望勤務日
                  </h3>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', color: 'var(--primary)' }}>{formatJobDates(selectedTalent.availableDates)}</p>
                </div>
              )}

              {/* 受講済み研修 */}
              {selectedTalent.completedTrainings && selectedTalent.completedTrainings.length > 0 && (
                <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#10B981' }}>verified</span>
                    受講済み研修
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selectedTalent.completedTrainings.map(tid => {
                      const tr = allTrainings.find(t => t.id === tid);
                      return (
                        <span key={tid} style={{ fontSize: '12px', padding: '4px 10px', background: '#D1FAE5', color: '#065F46', borderRadius: '16px', fontWeight: 'bold' }}>
                          ✓ {tr?.title || '受講済み研修'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 詳細情報 */}
              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>monetization_on</span>
                  希望単価
                </h3>
                <p style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>¥{selectedTalent.price?.toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-sub)' }}>/ 日〜</span></p>
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>corporate_fare</span>
                  拠点・最寄り駅
                </h3>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5' }}>
                  拠点: {selectedTalent.baseLocation || '未設定'}<br/>
                  最寄り駅: {selectedTalent.nearestStation || '未設定'}
                </p>
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>location_on</span>
                  希望勤務エリア
                </h3>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5' }}>{selectedTalent.preferredArea || '全国対応可能'}</p>
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>history</span>
                  経歴・実績
                </h3>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>{selectedTalent.experience || '記載なし'}</p>
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>edit_note</span>
                  自己PR
                </h3>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{selectedTalent.prText || '記載なし'}</p>
              </div>
            </>
          )}
        </main>

        <footer style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--surface-color)', padding: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '12px', zIndex: 10 }}>
          <button 
            onClick={handleStartTalentChat}
            style={{ flex: 1, padding: '12px', background: '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
          >
            <span className="material-symbols-outlined">send</span>
            メッセージを送る
          </button>
        </footer>
      </div>

      {/* 案件詳細 オーバーレイ */}
      <div className={`overlay-view ${selectedJob ? 'show' : ''}`} style={{ display: selectedJob ? 'flex' : 'none', transform: selectedJob ? 'translateX(0)' : 'translateX(100%)', zIndex: 2000 }}>
        <header className="solid-header overlay-header">
          <button className="icon-btn-dark" onClick={() => setSelectedJob(null)}>
            <span className="material-symbols-outlined">arrow_back_ios_new</span>
          </button>
          <h1 style={{ fontSize: '16px' }}>案件詳細</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            {currentUser && selectedJob && (
              <button 
                className="icon-btn-dark"
                onClick={(e) => handleToggleFavoriteJob(selectedJob.id, e)}
                style={{ color: currentUser.favoriteJobIds?.includes(selectedJob.id) ? '#EF4444' : 'inherit' }}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: currentUser.favoriteJobIds?.includes(selectedJob.id) ? "'FILL' 1" : "'FILL' 0" }}>
                  favorite
                </span>
              </button>
            )}
            <button className="icon-btn-dark">
              <span className="material-symbols-outlined">more_vert</span>
            </button>
          </div>
        </header>

        <main className="list-area bg-gray" style={{ flex: 1, overflowY: 'auto', paddingBottom: '100px' }}>
          {selectedJob && (
            <>
              <div style={{ background: 'var(--surface-color)', padding: '24px 16px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {selectedJob.carrier && <span style={{ fontSize: '12px', padding: '4px 10px', background: '#E0E7FF', color: '#4338CA', borderRadius: '16px', fontWeight: 'bold' }}>{selectedJob.carrier}</span>}
                  {selectedJob.salesChannel && <span style={{ fontSize: '12px', padding: '4px 10px', background: '#FEF3C7', color: '#D97706', borderRadius: '16px', fontWeight: 'bold' }}>{selectedJob.salesChannel}</span>}
                  {selectedJob.roleType && <span style={{ fontSize: '12px', padding: '4px 10px', background: '#DCFCE7', color: '#15803D', borderRadius: '16px', fontWeight: 'bold' }}>{selectedJob.roleType}</span>}
                  {selectedJob.workLocation && <span style={{ fontSize: '12px', padding: '4px 10px', background: '#F3F4F6', color: '#374151', borderRadius: '16px' }}>{selectedJob.workLocation}</span>}
                </div>
                 {selectedJob.jobCode && (
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                      案件コード: {selectedJob.jobCode}
                    </span>
                  </div>
                )}
                <h2 style={{ margin: '0 0 12px 0', fontSize: '20px', lineHeight: '1.4' }}>{selectedJob.title}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-sub)', fontSize: '14px', marginBottom: '8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>corporate_fare</span>
                  {allUsers.find(u => u.id === selectedJob.authorId)?.name || '不明な会社'}
                </div>
                {selectedJobRating && selectedJobRating.count > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                    <span style={{ color: '#F59E0B' }}>★</span>
                    <strong style={{ color: '#111827' }}>{selectedJobRating.average.toFixed(1)}</strong>
                    <span style={{ color: 'var(--text-sub)' }}>({selectedJobRating.count}件の評価)</span>
                  </div>
                )}
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>monetization_on</span>
                  単価（報酬）
                </h3>
                {selectedJob.dailyPrices && Object.keys(selectedJob.dailyPrices).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>稼働日ごとの単価内訳：</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: '#F8FAFC', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                      {Object.entries(selectedJob.dailyPrices).sort((a, b) => a[0].localeCompare(b[0])).map(([date, dailyPrice]) => (
                        <div key={date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                          <span style={{ color: 'var(--text-main)' }}>{date}</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>¥{dailyPrice?.toLocaleString()} / 日</span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold', color: 'var(--primary)' }}>
                        <span>想定支払額合計</span>
                        <span>¥{selectedJob.price?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: 'var(--primary)' }}>¥{selectedJob.price?.toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-main)' }}>/ 日</span></p>
                )}

                {/* 交通費・宿泊費の別途表示 */}
                {selectedJob.expenses && (selectedJob.expenses.transportType !== 'none' || selectedJob.expenses.accommodationType !== 'none') ? (
                  <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #E2E8F0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>諸経費の支給設定：</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--text-main)' }}>
                      {selectedJob.expenses.transportType !== 'none' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#4B5563' }}>directions_car</span>
                          <span>交通費：</span>
                          <span style={{ fontWeight: 'bold' }}>
                            {(() => {
                              const t = selectedJob.expenses.transportType;
                              const val = selectedJob.expenses.transportValue;
                              if (t === 'pay_separate') return val && val > 0 ? `あり（別途支給・上限 ${val?.toLocaleString()}円 / 日）` : 'あり（別途支給・上限なし）';
                              if (t === 'arranged') return 'あり（こちらで手配）';
                              if (t === 'flat') return `一律 ${val?.toLocaleString()}円 / 日`;
                              return `実費支給（上限 ${val?.toLocaleString()}円 / 日）`;
                            })()}
                          </span>
                        </div>
                      )}
                      {selectedJob.expenses.accommodationType !== 'none' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#4B5563' }}>hotel</span>
                          <span>宿泊費：</span>
                          <span style={{ fontWeight: 'bold' }}>
                            {(() => {
                              const t = selectedJob.expenses.accommodationType;
                              const val = selectedJob.expenses.accommodationValue;
                              if (t === 'pay_separate') return val && val > 0 ? `あり（別途支給・上限 ${val?.toLocaleString()}円 / 泊）` : 'あり（別途支給・上限なし）';
                              if (t === 'arranged') return 'あり（こちらで手配）';
                              if (t === 'flat') return `一律 ${val?.toLocaleString()}円 / 泊`;
                              return `実費支給（上限 ${val?.toLocaleString()}円 / 泊）`;
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #E2E8F0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-sub)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--text-sub)' }}>info</span>
                    <span>交通費・宿泊費の別途支給はありません（単価に含む）</span>
                  </div>
                )}
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>location_on</span>
                  勤務エリア
                </h3>
                <p style={{ margin: 0, fontSize: '15px' }}>{selectedJob.locationName || '記載なし'}</p>
              </div>

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>schedule</span>
                  勤務時間・期間
                </h3>
                <p style={{ margin: 0, fontSize: '15px', lineHeight: '1.6' }}>
                  {selectedJob.workHours || '記載なし'}<br/>
                  {selectedJob.eventDate && <>開催日: {selectedJob.eventDate}<br/></>}
                  {selectedJob.applicationDeadline && <span style={{ color: '#EF4444', fontWeight: 'bold' }}>応募締切: {selectedJob.applicationDeadline}</span>}
                </p>
              </div>

              {selectedJob.requirements && selectedJob.requirements.length > 0 && (
                <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>psychology</span>
                    求めるスキル・条件
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selectedJob.requirements.map(req => (
                      <span key={req} style={{ fontSize: '13px', padding: '6px 12px', background: '#F3F4F6', color: '#4B5563', borderRadius: '4px' }}>{req}</span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: 'var(--surface-color)', padding: '16px', marginTop: '8px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--text-sub)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>description</span>
                  業務内容の詳細
                </h3>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{selectedJob.detailedDescription || selectedJob.description}</p>
              </div>
            </>
          )}
        </main>

        {selectedJob && (selectedJob.authorId === currentUser?.id || currentUser?.companyType === 'agency' || currentUser?.companyType === 'both' || currentUser?.role === 'worker') && (
          <footer style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--surface-color)', padding: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '12px', zIndex: 10 }}>
            {selectedJob.authorId === currentUser?.id ? (
              <button 
                onClick={() => handleDuplicateJob(selectedJob)}
                style={{ flex: 1, padding: '12px', background: '#D97706', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>content_copy</span>
                この案件をコピーして新規作成
              </button>
            ) : (
              <button 
                onClick={async () => {
                  if (currentUser) {
                    const staffs = await api.getStaffsByUserId(currentUser.id);
                    setMyStaffs(staffs);
                    if (staffs.length > 0) {
                      setSelectedStaffId(staffs[0].id);
                    } else {
                      setSelectedStaffId('');
                    }
                  }
                  setIsNdaModalOpen(true);
                }}
                style={{ flex: 1, padding: '12px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
              >
                応募画面へ進む
              </button>
            )}
          </footer>
        )}

        {isNdaModalOpen && selectedJob && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ background: 'var(--surface-color)', padding: '24px', borderRadius: '16px', width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '24px' }}>security</span>
                応募の確認と秘密保持
              </h3>
              <p style={{ fontSize: '13px', color: '#64748B', margin: 0, lineHeight: '1.5' }}>
                マッチング成立後、正確な店舗情報・連絡先等がアプリ上で開示されます。情報漏洩には十分ご注意ください。
              </p>
              
              {/* 提案スタッフの選択 */}
              <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>
                  提案・アサインするスタッフを選択してください *
                </label>
                {myStaffs.length > 0 ? (
                  <>
                    <select
                      value={selectedStaffId}
                      onChange={e => setSelectedStaffId(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        fontSize: '14px',
                        background: 'var(--surface-color)',
                        outline: 'none',
                        color: 'var(--text-main)',
                        fontWeight: 'bold',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                    >
                      {myStaffs.map(staff => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name} ({staff.carriers.join(', ') || 'キャリア未指定'})
                        </option>
                      ))}
                    </select>

                    {/* 選択中のスタッフの簡易プロフィール */}
                    {(() => {
                      const selectedStaff = myStaffs.find(s => s.id === selectedStaffId);
                      if (!selectedStaff) return null;
                      
                      // Calculate attendance logs count and attendance rate from staff logs
                      const staffLogs = (selectedStaff.completedTrainings || []).filter((t: string) => t.startsWith('ATTENDANCE_LOG_'));
                      const checkinCount = staffLogs.length;

                      const lateLogsCount = staffLogs.filter((t: string) => t.endsWith('_LATE') || t.includes('_LATE')).length;
                      const staffAttendanceRate = staffLogs.length > 0 
                        ? Math.round(((staffLogs.length - lateLogsCount) / staffLogs.length) * 100) 
                        : 100;

                      return (
                        <div style={{
                          marginTop: '4px',
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          borderRadius: '10px',
                          padding: '12px',
                          fontSize: '12px',
                          color: 'var(--text-main)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', paddingBottom: '6px' }}>
                            <span style={{ fontWeight: 'bold', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>badge</span>
                              スタッフプロフィール
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 'bold' }}>
                              時間遵守率: <strong style={{ color: '#F59E0B' }}>{staffAttendanceRate}%</strong> (出勤{checkinCount}回)
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <div>
                              <span style={{ color: 'var(--text-sub)', fontSize: '10px', display: 'block' }}>拠点 / 最寄り駅</span>
                              <strong>{selectedStaff.baseLocation}</strong> ({selectedStaff.nearestStation || '未指定'})
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-sub)', fontSize: '10px', display: 'block' }}>性別</span>
                              <strong>{getStaffGender(selectedStaff.name)}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-sub)', fontSize: '10px', display: 'block' }}>対応スキル</span>
                              <strong>{selectedStaff.skills.join(', ') || '一般'}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-sub)', fontSize: '10px', display: 'block' }}>対応キャリア</span>
                              <strong>{selectedStaff.carriers.join(', ') || 'キャリア未指定'}</strong>
                            </div>
                          </div>

                          {selectedStaff.prText && (
                            <div style={{ background: 'var(--surface-color)', padding: '8px', borderRadius: '6px', border: '1px solid #E2E8F0', marginTop: '2px' }}>
                              <span style={{ color: 'var(--text-sub)', fontSize: '10px', display: 'block', marginBottom: '2px' }}>自己PR・アピール</span>
                              <div style={{ color: '#475569', lineHeight: '1.4', fontStyle: 'italic' }}>
                                「{selectedStaff.prText}」
                              </div>
                            </div>
                          )}

                          {selectedStaff.completedTrainings && selectedStaff.completedTrainings.filter(t => !t.startsWith('ATTENDANCE_LOG_') && !t.startsWith('CHECKIN_STATUS_')).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                              {selectedStaff.completedTrainings
                                .filter(t => !t.startsWith('ATTENDANCE_LOG_') && !t.startsWith('CHECKIN_STATUS_'))
                                .map(trId => {
                                  const trName = trId === 'tr1' ? '接客マナー' : trId === 'tr2' ? 'クロージング' : trId === 'tr3' ? '管理者研修' : trId;
                                  return (
                                    <span key={trId} style={{ background: '#E0F2FE', color: '#0369A1', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                      ✓ {trName}修了
                                    </span>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div style={{ padding: '10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', color: '#B45309', fontSize: '12px', lineHeight: '1.4' }}>
                    ⚠️ アサイン可能なスタッフが登録されていません。<br />
                    「設定」タブの「スタッフ管理」からスタッフを追加してください。デモ用に一時的に「仮のスタッフ」をアサインして応募します。
                  </div>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: 0, cursor: 'pointer', padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <input type="checkbox" checked={ndaAgreed} onChange={e => setNdaAgreed(e.target.checked)} style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: '#1E293B', fontWeight: 'bold', lineHeight: '1.4' }}>
                  本案件の条件等を理解し、開示される店舗情報等の秘密保持に同意します。
                </span>
              </label>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button onClick={() => { setIsNdaModalOpen(false); setNdaAgreed(false); }} style={{ flex: 1, padding: '12px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontWeight: 'bold', color: '#475569', cursor: 'pointer' }}>キャンセル</button>
                <button 
                  disabled={!ndaAgreed} 
                  onClick={handleJobApplication}
                  style={{ flex: 1, padding: '12px', background: ndaAgreed ? 'var(--primary)' : '#94A3B8', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: ndaAgreed ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}
                >
                  同意して応募
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 新規作成 オーバーレイ */}
      <div className={`overlay-view ${isCreateFormOpen ? 'show' : ''}`} style={{ display: isCreateFormOpen ? 'flex' : 'none', transform: isCreateFormOpen ? 'translateX(0)' : 'translateX(100%)', zIndex: 3000 }}>
        <header className="solid-header overlay-header">
          <button className="icon-btn-dark" onClick={() => setIsCreateFormOpen(false)} disabled={isSubmitting}>
            <span className="material-symbols-outlined">close</span>
          </button>
          <h1 style={{ fontSize: '16px' }}>新規追加</h1>
          <div style={{ width: '40px' }}></div>
        </header>

        <main className="list-area bg-gray" style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: '100px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
            <button 
              type="button"
              onClick={() => setCreateFormType('job')}
              disabled={isSubmitting}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: createFormType === 'job' ? '2px solid var(--primary)' : '1px solid var(--border-color)', background: createFormType === 'job' ? '#EFF6FF' : 'white', color: createFormType === 'job' ? 'var(--primary)' : 'var(--text-main)', fontWeight: 'bold' }}
            >
              案件情報を掲示
            </button>
            <button 
              type="button"
              onClick={() => setCreateFormType('talent')}
              disabled={isSubmitting}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: createFormType === 'talent' ? '2px solid #10B981' : '1px solid var(--border-color)', background: createFormType === 'talent' ? '#ECFDF5' : 'white', color: createFormType === 'talent' ? '#10B981' : 'var(--text-main)', fontWeight: 'bold' }}
            >
              人材情報を掲示
            </button>
          </div>

          <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {createFormType === 'job' ? (
              <>
                {/* 現場情報カード */}
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--primary)', borderBottom: '2px solid #E2E8F0', paddingBottom: '6px', marginBottom: '4px' }}>
                    1. 現場情報（勤務地・日程・諸経費）
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>案件タイトル *</label>
                    <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} placeholder="例: auショップ新宿 イベントスタッフ" />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>業務内容の詳細 *</label>
                    <textarea required rows={4} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} placeholder="具体的な仕事内容を記載してください"></textarea>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>稼働場所のタイプ *</label>
                    <select required value={formData.workLocation} onChange={e => setFormData({...formData, workLocation: e.target.value as any, locationName: formData.exactLocation ? generateMaskedLocation(formData.exactLocation, formData.exactLocation, formData.salesChannel, formData.carrier, e.target.value) : formData.locationName})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', background: 'var(--surface-color)' }}>
                      <option value="店内">店内</option>
                      <option value="外販（複合施設など）">外販（複合施設など）</option>
                      <option value="外販（スーパーなど）">外販（スーパーなど）</option>
                      <option value="外販（その他）">外販（その他）</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>正確な店舗名・住所 (非公開) *</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
                        <Autocomplete
                          key={`autocomplete_${mapSelectionKey}`}
                          onPlaceSelected={(place: any) => {
                            if (place.geometry) {
                              const lat = place.geometry.location.lat();
                              const lng = place.geometry.location.lng();
                              const address = place.name || place.formatted_address || '';
                              const fullAddress = place.formatted_address || address;
                              
                              setTempSelectedLocation({ lat, lng });
                              setFormData(prev => ({
                                ...prev,
                                exactLocation: address,
                                locationName: generateMaskedLocation(fullAddress, address, prev.salesChannel, prev.carrier, prev.workLocation)
                              }));
                              setMapSelectionKey(k => k + 1);
                              
                              if (mapRef.current) {
                                if (tempMarkerRef.current) {
                                  tempMarkerRef.current.map = null;
                                }
                                
                                if (advancedMarkerClassRef.current) {
                                  const AdvancedMarkerElement = advancedMarkerClassRef.current;
                                  const tempPin = document.createElement('div');
                                  tempPin.className = 'temp-location-marker';
                                  tempPin.innerHTML = `<div style="width: 20px; height: 20px; background-color: #EF4444; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`;

                                  tempMarkerRef.current = new AdvancedMarkerElement({
                                    map: mapRef.current,
                                    position: { lat, lng },
                                    content: tempPin,
                                  });
                                }
                                mapRef.current.setCenter({ lat, lng });
                                mapRef.current.setZoom(16);
                              }
                            }
                          }}
                          options={{
                            types: ['establishment', 'geocode'],
                            componentRestrictions: { country: 'jp' },
                          }}
                          defaultValue={formData.exactLocation}
                          onChange={(e: any) => {
                            const newExact = e.target.value;
                            setFormData({...formData, exactLocation: newExact, locationName: generateMaskedLocation(newExact, newExact, formData.salesChannel, formData.carrier, formData.workLocation)});
                          }}
                          disabled={isSubmitting} 
                          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} 
                          placeholder="例: ヤマダデンキ 新宿西口店" 
                        />
                      ) : (
                        <input 
                          key={`input_${mapSelectionKey}`}
                          type="text" 
                          required 
                          value={formData.exactLocation} 
                          onChange={e => {
                            const newExact = e.target.value;
                            setFormData({...formData, exactLocation: newExact, locationName: generateMaskedLocation(newExact, newExact, formData.salesChannel, formData.carrier, formData.workLocation)});
                          }} 
                          disabled={isSubmitting} 
                          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} 
                          placeholder="※APIキー未設定: 手動で入力してください" 
                        />
                      )}
                      <button
                        type="button"
                        onClick={startMapSelection}
                        disabled={isSubmitting}
                        style={{
                          padding: '10px 14px',
                          background: 'var(--primary)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '13px',
                          boxShadow: '0 2px 4px rgba(37,99,235,0.2)'
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>map</span>
                        地図から選択
                      </button>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-sub)' }}>
                      ※地図をクリックすると住所が自動入力され、公開用の表示名も自動生成されます
                    </span>

                    {/* 公開用表示名プレビュー（チップ形式） */}
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      flexWrap: 'wrap', 
                      gap: '8px', 
                      marginTop: '2px',
                      background: '#F8FAFC',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #E2E8F0'
                    }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-sub)', fontWeight: 'bold' }}>求職者への公開名:</span>
                      {isEditingLocationName ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, minWidth: '200px' }}>
                          <input 
                            type="text" 
                            required 
                            value={formData.locationName} 
                            onChange={e => setFormData({...formData, locationName: e.target.value})} 
                            disabled={isSubmitting} 
                            style={{ flex: 1, padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #CBD5E1', background: 'var(--surface-color)' }} 
                            placeholder="例: 新宿区の量販店" 
                          />
                          <button
                            type="button"
                            onClick={() => setIsEditingLocationName(false)}
                            style={{
                              padding: '4px 8px',
                              background: 'var(--primary)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              fontWeight: 'bold'
                            }}
                          >
                            確定
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            padding: '3px 8px', 
                            background: '#EFF6FF', 
                            color: '#1E40AF', 
                            borderRadius: '12px', 
                            border: '1px solid #BFDBFE', 
                            fontSize: '12px', 
                            fontWeight: 'bold' 
                          }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px', color: '#3B82F6' }}>visibility</span>
                            {formData.locationName || '(正確な店舗名を入力すると自動生成されます)'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsEditingLocationName(true)}
                            style={{
                              padding: '2px 6px',
                              background: 'none',
                              border: '1px solid #CBD5E1',
                              borderRadius: '4px',
                              fontSize: '10px',
                              color: 'var(--primary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              fontWeight: 'bold'
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>edit</span>
                            編集
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>キャリア/回線 *</label>
                      <select required value={formData.carrier} onChange={e => setFormData({...formData, carrier: e.target.value as any, locationName: formData.exactLocation ? generateMaskedLocation(formData.exactLocation, formData.exactLocation, formData.salesChannel, e.target.value, formData.workLocation) : formData.locationName})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', background: 'var(--surface-color)' }}>
                        <option value="" disabled>選択</option>
                        <option value="docomo">docomo</option>
                        <option value="au/UQmobile">au/UQmobile</option>
                        <option value="SoftBank/Y!mobile">SoftBank/Y!mobile</option>
                        <option value="BB">BB</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>販路 *</label>
                      <select required value={formData.salesChannel} onChange={e => setFormData({...formData, salesChannel: e.target.value as any, locationName: formData.exactLocation ? generateMaskedLocation(formData.exactLocation, formData.exactLocation, e.target.value, formData.carrier, formData.workLocation) : formData.locationName})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', background: 'var(--surface-color)' }}>
                        <option value="" disabled>選択</option>
                        <option value="量販店">量販店</option>
                        <option value="ショップ">ショップ</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>応募締切日 *</label>
                      <input type="date" required value={formData.applicationDeadline} onChange={e => setFormData({...formData, applicationDeadline: e.target.value})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '4px' }}>開催日 (複数選択可) *</label>
                    <CalendarPicker selectedDates={selectedJobDates} onChange={dates => setSelectedJobDates(dates)} />
                    {selectedJobDates.length > 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 'bold', marginTop: '4px' }}>
                        選択中: {selectedJobDates.length}日間 ({[...selectedJobDates].sort().join(', ')})
                      </div>
                    )}
                  </div>

                  {/* 交通費・宿泊費の支給設定 */}
                  <div style={{ background: 'var(--surface-color)', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)' }}>交通費・宿泊費の設定</div>
                    
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-sub)' }}>交通費支給</label>
                        <select 
                          value={expenses.transportType} 
                          onChange={e => setExpenses(prev => ({ ...prev, transportType: e.target.value as any }))}
                          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', background: 'var(--surface-color)', fontSize: '13px' }}
                        >
                          <option value="none">なし（単価に含む）</option>
                          <option value="pay_separate">あり（別途支給）</option>
                          <option value="arranged">あり（こちらで手配）</option>
                        </select>
                        {expenses.transportType === 'pay_separate' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input 
                                type="number" 
                                className="no-spin"
                                value={expenses.transportValue || ''} 
                                onChange={e => setExpenses(prev => ({ ...prev, transportValue: e.target.value ? Number(e.target.value) : 0 }))}
                                onWheel={e => e.currentTarget.blur()}
                                placeholder="上限額（任意）" 
                                style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '12px', width: '100px' }} 
                              />
                              <span style={{ fontSize: '12px' }}>円 / 日</span>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--text-sub)' }}>※空欄は上限なし</span>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-sub)' }}>宿泊費支給</label>
                        <select 
                          value={expenses.accommodationType} 
                          onChange={e => setExpenses(prev => ({ ...prev, accommodationType: e.target.value as any }))}
                          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', background: 'var(--surface-color)', fontSize: '13px' }}
                        >
                          <option value="none">なし（単価に含む）</option>
                          <option value="pay_separate">あり（別途支給）</option>
                          <option value="arranged">あり（こちらで手配）</option>
                        </select>
                        {expenses.accommodationType === 'pay_separate' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input 
                                type="number" 
                                className="no-spin"
                                value={expenses.accommodationValue || ''} 
                                onChange={e => setExpenses(prev => ({ ...prev, accommodationValue: e.target.value ? Number(e.target.value) : 0 }))}
                                onWheel={e => e.currentTarget.blur()}
                                placeholder="上限額（任意）" 
                                style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '12px', width: '100px' }} 
                              />
                              <span style={{ fontSize: '12px' }}>円 / 泊</span>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--text-sub)' }}>※空欄は上限なし</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                        <input type="checkbox" checked={formData.isUrgent} onChange={e => setFormData({...formData, isUrgent: e.target.checked})} disabled={isSubmitting} style={{ width: '16px', height: '16px' }} />
                        <span style={{ color: '#EF4444' }}>🚨 緊急募集にする</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                        <input type="checkbox" checked={formData.isLimited} onChange={e => setFormData({...formData, isLimited: e.target.checked})} disabled={isSubmitting} style={{ width: '16px', height: '16px' }} />
                        <span style={{ color: 'var(--primary)' }}>🔒 限定公開</span>
                      </label>
                    </div>

                    {formData.isLimited && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', background: 'var(--surface-color)', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)' }}>公開先企業を選択してください *</label>
                        <select 
                          value={targetCompanyId} 
                          onChange={e => setTargetCompanyId(e.target.value)} 
                          disabled={isSubmitting} 
                          style={{ padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', background: 'var(--surface-color)', fontSize: '14px', outline: 'none' }}
                        >
                          {allUsers
                            .filter(u => u.id !== currentUser?.id)
                            .map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                {/* 人員情報カード */}
                <div style={{ background: '#FFFDF9', padding: '16px', borderRadius: '12px', border: '1px solid #FCD34D', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#D97706', borderBottom: '2px solid #FCD34D', paddingBottom: '6px', marginBottom: '4px' }}>
                    2. 人員情報（スキル・単価）
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>スキル *</label>
                    <select required value={formData.roleType} onChange={e => setFormData({...formData, roleType: e.target.value})} disabled={isSubmitting} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', background: 'var(--surface-color)' }}>
                      <option value="" disabled>選択してください</option>
                      <option value="キャンペーンクルー">キャンペーンクルー</option>
                      <option value="クローザー">クローザー</option>
                      <option value="ディレクター">ディレクター</option>
                    </select>
                  </div>

                  {/* 単価の入力設定 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                      <input 
                        type="checkbox" 
                        checked={isSamePriceAllDates}
                        onChange={e => handleToggleSamePrice(e.target.checked)}
                        disabled={isSubmitting} 
                        style={{ width: '16px', height: '16px' }} 
                      />
                      <span>すべての稼働日で同じ単価を設定する</span>
                    </label>

                    {isSamePriceAllDates ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-sub)' }}>日当単価 (円) *</label>
                        <input 
                          type="number" 
                          className="no-spin"
                          required 
                          value={commonPrice || ''} 
                          onChange={e => setCommonPrice(Number(e.target.value))} 
                          onWheel={e => e.currentTarget.blur()}
                          disabled={isSubmitting} 
                          style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} 
                          placeholder="例: 15000" 
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--surface-color)', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)' }}>日程ごとの単価設定</div>
                        {selectedJobDates.length === 0 ? (
                          <div style={{ fontSize: '12px', color: '#EF4444', fontStyle: 'italic' }}>
                            ※ 上記で「開催日」を選択すると、ここに日程別の入力欄が表示されます。
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[...selectedJobDates].sort().map(date => (
                              <div key={date} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{date} :</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <input 
                                    type="number" 
                                    className="no-spin"
                                    required 
                                    value={dailyPrices[date] || ''} 
                                    onChange={e => setDailyPrices(prev => ({ ...prev, [date]: Number(e.target.value) }))} 
                                    onWheel={e => e.currentTarget.blur()}
                                    disabled={isSubmitting} 
                                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '120px', fontSize: '13px' }} 
                                    placeholder="単価を入力" 
                                  />
                                  <span style={{ fontSize: '13px' }}>円</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 想定支払総額のサマリープレビュー */}
                  <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '12px', borderRadius: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px', color: '#1E40AF', fontWeight: 'bold' }}>
                      案件の想定総支払額 (仮押さえ額)
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1E3A8A' }}>
                      ¥ {Object.values(dailyPrices).reduce((sum, val) => sum + val, 0)?.toLocaleString()}
                      <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#475569', marginLeft: '4px' }}>
                        ({selectedJobDates.length}日間分)
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>掲示するスタッフを選択 *</label>
                  {myStaffs.length > 0 ? (
                    <select 
                      value={selectedStaffId} 
                      onChange={e => setSelectedStaffId(e.target.value)} 
                      disabled={isSubmitting} 
                      style={{ padding: '12px', borderRadius: '8px', border: '1px solid #ccc', background: 'var(--surface-color)', fontSize: '15px' }}
                    >
                      {myStaffs.map(staff => (
                        <option key={staff.id} value={staff.id}>{staff.name} ({staff.maskedName}) - {staff.baseLocation}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ padding: '16px', background: '#FEE2E2', color: '#991B1B', borderRadius: '8px', fontSize: '14px' }}>
                      登録されているスタッフがいません。先にスタッフを登録してください。
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>希望日当単価 (円) *</label>
                  <input 
                    type="number" 
                    className="no-spin"
                    required 
                    value={talentPrice || ''} 
                    onChange={e => setTalentPrice(Number(e.target.value))} 
                    onWheel={e => e.currentTarget.blur()}
                    disabled={isSubmitting} 
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '15px' }} 
                    placeholder="例: 15000" 
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>希望勤務日 *</label>
                  <CalendarPicker 
                    selectedDates={formData.selectedDates}
                    onChange={(dates) => setFormData({...formData, selectedDates: dates})}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-sub)', marginTop: '4px' }}>※連続した日程や飛び石の日程もタップして複数選択できます。</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px', marginBottom: '16px' }}>
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsCreateFormOpen(false);
                      navigate('/manage');
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '14px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>person_add</span>
                    ＋新しいスタッフを登録する
                  </button>
                </div>
              </>
            )}

            <button type="submit" disabled={isSubmitting || (createFormType === 'talent' && (myStaffs.length === 0 || formData.selectedDates.length === 0))} style={{ padding: '14px', background: createFormType === 'job' ? 'var(--primary)' : '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: (isSubmitting || (createFormType === 'talent' && (myStaffs.length === 0 || formData.selectedDates.length === 0))) ? 'not-allowed' : 'pointer', marginTop: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', opacity: (isSubmitting || (createFormType === 'talent' && (myStaffs.length === 0 || formData.selectedDates.length === 0))) ? 0.7 : 1 }}>
              {isSubmitting ? '登録中...' : '掲示する'}
            </button>
          </form>
        </main>
      </div>

      {/* フィルターボトムシート */}
      <div className={`filter-sheet-backdrop ${isFilterSheetOpen ? 'show' : ''}`} onClick={() => setIsFilterSheetOpen(false)} style={{ zIndex: 3500 }}>
        <div className={`filter-sheet ${isFilterSheetOpen ? 'show' : ''}`} onClick={e => e.stopPropagation()}>
          <div className="filter-sheet-header">
            <span className="filter-sheet-title">絞り込み・ソート</span>
            <button className="filter-sheet-close" onClick={() => setIsFilterSheetOpen(false)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          
          <div className="filter-sheet-body">
            {/* キーワード・地名検索 (共通・大型) */}
            <div className="filter-group">
              <span className="filter-group-title">キーワード・地名で検索</span>
              <div className="filter-kw-big">
                <span className="material-symbols-outlined">search</span>
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={e => setSearchKeyword(e.target.value)}
                  placeholder={mode === 'job' ? '職種・エリア・発注企業名で検索' : '名前・スキル・エリアで検索'}
                />
                {searchKeyword && (
                  <button type="button" aria-label="キーワードをクリア" onClick={() => setSearchKeyword('')}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                  </button>
                )}
              </div>
            </div>

            {/* 並び替え */}
            <div className="filter-group">
              <span className="filter-group-title">並び替え</span>
              <div className="filter-sort-list">
                {((mode === 'job'
                  ? [
                      { v: 'newest', label: '新着順' },
                      { v: 'deadlineNear', label: '応募締切が近い順' },
                      { v: 'dateNear', label: '開催日が近い順' },
                      { v: 'priceHigh', label: '単価が高い順' },
                      { v: 'priceLow', label: '単価が安い順' },
                      { v: 'nearest', label: '現在地から近い順', needsLoc: true },
                    ]
                  : [
                      { v: 'priceLow', label: '単価が安い順' },
                      { v: 'priceHigh', label: '単価が高い順' },
                      { v: 'expLong', label: '経験が長い順' },
                      { v: 'trainingsMany', label: '研修受講数が多い順' },
                      { v: 'nearest', label: '拠点が近い順', needsLoc: true },
                    ]
                ) as { v: string; label: string; needsLoc?: boolean }[]).map(opt => {
                  const current = mode === 'job' ? jobSortOrder : talentSortOrder;
                  const locked = !!opt.needsLoc && !userLocation;
                  const active = current === opt.v;
                  return (
                    <label
                      key={opt.v}
                      className={`filter-sort-row ${active ? 'active' : ''} ${locked ? 'is-disabled' : ''}`}
                      onClick={locked ? requestLocation : undefined}
                    >
                      <input
                        type="radio"
                        name="sortOrder"
                        checked={active}
                        disabled={locked}
                        onChange={() => {
                          if (mode === 'job') setJobSortOrder(opt.v as typeof jobSortOrder);
                          else setTalentSortOrder(opt.v as typeof talentSortOrder);
                        }}
                      />
                      <span>{opt.label}</span>
                      {locked
                        ? <span className="hint">位置情報の許可が必要</span>
                        : active
                          ? <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>check</span>
                          : null}
                    </label>
                  );
                })}
              </div>
            </div>

            <span className="filter-group-title" style={{ marginBottom: '-8px' }}>絞り込み</span>

            {/* 都道府県 (共通) */}
            <div className="filter-group">
              <span className="filter-group-title">
                都道府県{mode === 'talent' ? '（拠点）' : ''}
                {filterPrefectures.length > 0 && <span className="fg-count">{filterPrefectures.length}</span>}
              </span>
              <button
                type="button"
                onClick={() => { setPrefPickerQuery(''); setIsPrefPickerOpen(true); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--surface-color)', fontSize: '14px', color: 'var(--text-main)', fontFamily: 'inherit', cursor: 'pointer', width: '100%' }}
              >
                <span>
                  {filterPrefectures.length === 0
                    ? '指定なし'
                    : filterPrefectures.length <= 2
                      ? filterPrefectures.join('・')
                      : `${filterPrefectures.slice(0, 2).join('・')} ほか${filterPrefectures.length - 2}`}
                </span>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--text-sub)' }}>chevron_right</span>
              </button>
              {filterPrefectures.length > 0 && (
                <div className="filter-options-flex">
                  {filterPrefectures.map(p => (
                    <button
                      key={p}
                      type="button"
                      className="filter-checkbox-label active"
                      style={{ cursor: 'pointer', fontFamily: 'inherit' }}
                      onClick={() => setFilterPrefectures(prev => prev.filter(x => x !== p))}
                    >
                      {p}
                      <span className="material-symbols-outlined" style={{ fontSize: '14px', marginLeft: '4px' }}>close</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {mode === 'job' ? (
              <>
                {/* 職種 */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    職種{filterJobRoles.length > 0 && <span className="fg-count">{filterJobRoles.length}</span>}
                  </span>
                  <div className="filter-options-flex">
                    {['キャンペーンクルー', 'クローザー', 'ディレクター'].map(role => {
                      const isChecked = filterJobRoles.includes(role);
                      return (
                        <label key={role} className={`filter-checkbox-label ${isChecked ? 'active' : ''}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setFilterJobRoles(prev => isChecked ? prev.filter(r => r !== role) : [...prev, role])} />
                          {role}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* キャリア/回線 */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    キャリア/回線{filterCarriers.length > 0 && <span className="fg-count">{filterCarriers.length}</span>}
                  </span>
                  <div className="filter-options-flex">
                    {['docomo', 'au/UQmobile', 'SoftBank/Y!mobile', 'BB'].map(carrier => {
                      const isChecked = filterCarriers.includes(carrier);
                      return (
                        <label key={carrier} className={`filter-checkbox-label ${isChecked ? 'active' : ''}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setFilterCarriers(prev => isChecked ? prev.filter(c => c !== carrier) : [...prev, carrier])} />
                          {carrier}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 販路 */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    販路{filterChannels.length > 0 && <span className="fg-count">{filterChannels.length}</span>}
                  </span>
                  <div className="filter-options-flex">
                    {['ショップ', '量販店'].map(channel => {
                      const isChecked = filterChannels.includes(channel);
                      return (
                        <label key={channel} className={`filter-checkbox-label ${isChecked ? 'active' : ''}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setFilterChannels(prev => isChecked ? prev.filter(c => c !== channel) : [...prev, channel])} />
                          {channel}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 単価(下限・上限) */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    単価（円/日）
                    <span style={{ float: 'right', fontWeight: 700, color: 'var(--primary)', textTransform: 'none', letterSpacing: 0 }}>
                      ¥{filterMinPrice.toLocaleString()} 〜 {filterMaxPrice >= PRICE_SLIDER_MAX ? '上限なし' : `¥${filterMaxPrice.toLocaleString()}`}
                    </span>
                  </span>
                  <div className="price-range">
                    <div className="track" />
                    <div
                      className="track-fill"
                      style={{
                        left: `${(filterMinPrice / PRICE_SLIDER_MAX) * 100}%`,
                        right: `${100 - (filterMaxPrice / PRICE_SLIDER_MAX) * 100}%`,
                      }}
                    />
                    <input
                      type="range"
                      min={PRICE_SLIDER_MIN}
                      max={PRICE_SLIDER_MAX}
                      step={PRICE_SLIDER_STEP}
                      value={filterMinPrice}
                      onChange={e => {
                        const v = Math.min(Number(e.target.value), filterMaxPrice - PRICE_SLIDER_STEP);
                        setFilterMinPrice(Math.max(PRICE_SLIDER_MIN, v));
                      }}
                    />
                    <input
                      type="range"
                      min={PRICE_SLIDER_MIN}
                      max={PRICE_SLIDER_MAX}
                      step={PRICE_SLIDER_STEP}
                      value={filterMaxPrice}
                      onChange={e => {
                        const v = Math.max(Number(e.target.value), filterMinPrice + PRICE_SLIDER_STEP);
                        setFilterMaxPrice(Math.min(PRICE_SLIDER_MAX, v));
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-sub)', marginTop: '2px' }}>
                    <span>¥0</span>
                    <span>¥{(PRICE_SLIDER_MAX).toLocaleString()}+</span>
                  </div>
                </div>

                {/* 応募締切 */}
                <div className="filter-group">
                  <span className="filter-group-title">応募締切</span>
                  <div className="filter-options-flex">
                    {[{ v: null as number | null, l: '指定なし' }, { v: 3, l: '3日以内' }, { v: 7, l: '1週間以内' }, { v: 14, l: '2週間以内' }].map(o => (
                      <label key={String(o.v)} className={`filter-checkbox-label ${filterDeadlineDays === o.v ? 'active' : ''}`}>
                        <input type="radio" name="deadlineDays" checked={filterDeadlineDays === o.v} onChange={() => setFilterDeadlineDays(o.v)} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>

                {/* トグル */}
                <div className="filter-group">
                  <label className="filter-toggle-row">
                    <span>諸経費ありの案件のみ</span>
                    <input type="checkbox" checked={filterHasExpenses} onChange={e => setFilterHasExpenses(e.target.checked)} />
                  </label>
                  <label className="filter-toggle-row">
                    <span>お気に入りのみ</span>
                    <input type="checkbox" checked={showFavoritesOnly} onChange={e => setShowFavoritesOnly(e.target.checked)} />
                  </label>
                </div>
              </>
            ) : (
              <>
                {/* 対応スキル */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    対応スキル{filterTalentSkills.length > 0 && <span className="fg-count">{filterTalentSkills.length}</span>}
                  </span>
                  <div className="filter-options-flex">
                    {['キャンペーンクルー', 'クローザー', 'ディレクター'].map(skill => {
                      const isChecked = filterTalentSkills.includes(skill);
                      return (
                        <label key={skill} className={`filter-checkbox-label ${isChecked ? 'active' : ''}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setFilterTalentSkills(prev => isChecked ? prev.filter(s => s !== skill) : [...prev, skill])} />
                          {skill}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 対応キャリア */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    対応キャリア{filterTalentCarriers.length > 0 && <span className="fg-count">{filterTalentCarriers.length}</span>}
                  </span>
                  <div className="filter-options-flex">
                    {['docomo', 'au/UQmobile', 'SoftBank/Y!mobile', 'BB'].map(carrier => {
                      const isChecked = filterTalentCarriers.includes(carrier);
                      return (
                        <label key={carrier} className={`filter-checkbox-label ${isChecked ? 'active' : ''}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setFilterTalentCarriers(prev => isChecked ? prev.filter(c => c !== carrier) : [...prev, carrier])} />
                          {carrier}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 受講済み研修 */}
                <div className="filter-group">
                  <span className="filter-group-title">
                    受講済み研修{filterTalentTrainings.length > 0 && <span className="fg-count">{filterTalentTrainings.length}</span>}
                  </span>
                  <div className="filter-options-flex">
                    {allTrainings.map(tr => {
                      const isChecked = filterTalentTrainings.includes(tr.id);
                      return (
                        <label key={tr.id} className={`filter-checkbox-label ${isChecked ? 'active' : ''}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setFilterTalentTrainings(prev => isChecked ? prev.filter(t => t !== tr.id) : [...prev, tr.id])} />
                          {tr.title}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 最低経験年数 */}
                <div className="filter-group">
                  <span className="filter-group-title">最低経験年数</span>
                  <div className="filter-options-flex">
                    {[{ v: 0, l: '不問' }, { v: 1, l: '1年+' }, { v: 3, l: '3年+' }, { v: 5, l: '5年+' }].map(o => (
                      <label key={o.v} className={`filter-checkbox-label ${filterMinExperience === o.v ? 'active' : ''}`}>
                        <input type="radio" name="minExp" checked={filterMinExperience === o.v} onChange={() => setFilterMinExperience(o.v)} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>

                {/* お気に入り */}
                <div className="filter-group">
                  <label className="filter-toggle-row">
                    <span>お気に入りのみ</span>
                    <input type="checkbox" checked={showFavoritesOnly} onChange={e => setShowFavoritesOnly(e.target.checked)} />
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="filter-sheet-footer" style={{ display: 'flex', gap: '12px', padding: '16px', borderTop: '1px solid var(--border-color)', background: 'var(--surface-color)' }}>
            <button
              style={{
                flex: 1,
                margin: 0,
                padding: '12px',
                background: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                borderRadius: '10px',
                fontWeight: '600',
                fontSize: '14px',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
              onClick={clearAllFilters}
            >
              すべてクリア
            </button>
            <button
              style={{
                flex: 1,
                margin: 0,
                padding: '12px',
                background: 'var(--primary)',
                border: 'none',
                color: 'white',
                borderRadius: '10px',
                fontWeight: '700',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(37,99,235,0.3)',
                fontFamily: 'inherit'
              }}
              onClick={() => {
                setIsFilterSheetOpen(false);
                setViewMode('list');
              }}
            >
              {resultCount}{mode === 'job' ? '件' : '名'}を表示
            </button>
          </div>
        </div>
      </div>

      {/* 都道府県ピッカー(絞り込みシートの上に重ねて表示) */}
      <div
        className={`filter-sheet-backdrop ${isPrefPickerOpen ? 'show' : ''}`}
        onClick={() => setIsPrefPickerOpen(false)}
        style={{ zIndex: 3600 }}
      >
        <div className={`filter-sheet ${isPrefPickerOpen ? 'show' : ''}`} onClick={e => e.stopPropagation()} style={{ zIndex: 3601 }}>
          <div className="filter-sheet-header">
            <span className="filter-sheet-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="filter-sheet-close" onClick={() => setIsPrefPickerOpen(false)} aria-label="戻る">
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              都道府県で絞り込み
            </span>
            <button className="filter-sheet-close" onClick={() => setIsPrefPickerOpen(false)} aria-label="閉じる">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="filter-sheet-body">
            <div className="filter-kw-big">
              <span className="material-symbols-outlined">search</span>
              <input
                type="text"
                value={prefPickerQuery}
                onChange={e => setPrefPickerQuery(e.target.value)}
                placeholder="都道府県名で検索"
              />
              {prefPickerQuery && (
                <button type="button" aria-label="クリア" onClick={() => setPrefPickerQuery('')}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                </button>
              )}
            </div>

            {prefPickerQuery.trim() ? (
              <div>
                {ALL_PREFECTURES.filter(p => p.includes(prefPickerQuery.trim())).map(p => {
                  const on = filterPrefectures.includes(p);
                  return (
                    <label key={p} className="pref-picker-row">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setFilterPrefectures(prev => on ? prev.filter(x => x !== p) : [...prev, p])}
                      />
                      {p}
                    </label>
                  );
                })}
                {ALL_PREFECTURES.filter(p => p.includes(prefPickerQuery.trim())).length === 0 && (
                  <div style={{ padding: '16px 2px', fontSize: '13px', color: 'var(--text-sub)' }}>該当する都道府県がありません</div>
                )}
              </div>
            ) : (
              PREFECTURE_REGIONS.map(region => {
                const allOn = region.prefectures.every(p => filterPrefectures.includes(p));
                return (
                  <div key={region.name}>
                    <div className="pref-picker-region">
                      <span>{region.name}</span>
                      <button
                        type="button"
                        onClick={() => setFilterPrefectures(prev =>
                          allOn
                            ? prev.filter(x => !region.prefectures.includes(x))
                            : Array.from(new Set([...prev, ...region.prefectures]))
                        )}
                      >
                        {allOn ? '選択を解除' : 'すべて選択'}
                      </button>
                    </div>
                    {region.prefectures.map(p => {
                      const on = filterPrefectures.includes(p);
                      return (
                        <label key={p} className="pref-picker-row">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setFilterPrefectures(prev => on ? prev.filter(x => x !== p) : [...prev, p])}
                          />
                          {p}
                        </label>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          <div className="filter-sheet-footer" style={{ display: 'flex', gap: '12px', padding: '16px', borderTop: '1px solid var(--border-color)', background: 'var(--surface-color)' }}>
            <button
              style={{ flex: 1, margin: 0, padding: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '10px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => setFilterPrefectures([])}
            >
              選択をクリア
            </button>
            <button
              style={{ flex: 1, margin: 0, padding: '12px', background: 'var(--primary)', border: 'none', color: 'white', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => setIsPrefPickerOpen(false)}
            >
              {filterPrefectures.length > 0 ? `${filterPrefectures.length}件を選択` : '完了'}
            </button>
          </div>
        </div>
      </div>

      {/* マップピン詳細のボトムシート */}
      {viewMode === 'map' && !isSelectingLocationOnMap && selectedMapJobs && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom))',
          left: 0,
          right: 0,
          backgroundColor: 'var(--surface-color)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          boxShadow: '0 -10px 25px rgba(0,0,0,0.15)',
          zIndex: 1500,
          padding: '20px 16px 24px 16px',
          maxHeight: '45vh',
          overflowY: 'auto',
          borderTop: '1px solid var(--border-color)',
          fontFamily: "'Inter', sans-serif",
          animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}>
          <div style={{
            width: '40px',
            height: '4px',
            backgroundColor: '#E5E7EB',
            borderRadius: '2px',
            margin: '0 auto 16px auto'
          }}></div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main)' }}>
              {selectedMapJobs.length > 0 ? getCommonAreaName(selectedMapJobs.map(j => j.locationName || '')) : 'このエリア'}の募集: {selectedMapJobs.length}件
            </span>
            <button 
              onClick={() => setSelectedMapJobs(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-sub)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>close</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {selectedMapJobs.map(job => (
              <div 
                key={job.id} 
                className={`job-card-modern ${job.isUrgent ? 'job-card-urgent' : ''}`}
                style={{ 
                  margin: 0,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  border: job.isUrgent ? '1px solid #FECACA' : '1px solid var(--border-color)',
                  padding: '16px',
                  borderRadius: '12px',
                  background: job.isUrgent ? '#FEF2F2' : 'white'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {job.isUrgent && (
                      <span className="badge-urgent" style={{ fontSize: '10px', padding: '2px 6px' }}>緊急募集</span>
                    )}
                    <span className="badge-role" style={{ fontSize: '10px', padding: '2px 6px' }}>{job.roleType}</span>
                  </div>
                  <div className="job-price" style={{ fontSize: '15px' }}>
                    <span className="price-num">¥{job.price?.toLocaleString()}</span>
                    <span className="price-unit">/日</span>
                  </div>
                </div>

                <h4 style={{ 
                  fontSize: '14px', 
                  fontWeight: 'bold', 
                  color: 'var(--text-main)', 
                  margin: '8px 0',
                  lineHeight: '1.4'
                }}>
                  {job.title}
                </h4>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11px', color: 'var(--text-sub)' }}>
                    {job.carrier && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>phone_android</span>
                        {job.carrier}
                      </span>
                    )}
                    {job.salesChannel && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>storefront</span>
                        {job.salesChannel}
                      </span>
                    )}
                  </div>
                  <button 
                    className="view-job-btn" 
                    data-id={job.id}
                    onClick={() => {
                      if (currentUser?.status === 'pending') {
                        alert('本人確認書類（登記簿等）の審査中です。\n審査完了後に詳細情報が閲覧可能になります。');
                        return;
                      }
                      setSelectedJob(job);
                    }}
                    style={{ 
                      padding: '6px 14px', 
                      background: 'var(--primary)', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '8px', 
                      cursor: 'pointer', 
                      fontSize: '12px', 
                      fontWeight: 'bold' 
                    }}
                  >
                    詳細を見る
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'map' && !isSelectingLocationOnMap && selectedMapTalents && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom))',
          left: 0,
          right: 0,
          backgroundColor: 'var(--surface-color)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          boxShadow: '0 -10px 25px rgba(0,0,0,0.15)',
          zIndex: 1500,
          padding: '20px 16px 24px 16px',
          maxHeight: '45vh',
          overflowY: 'auto',
          borderTop: '1px solid var(--border-color)',
          fontFamily: "'Inter', sans-serif",
          animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}>
          <div style={{
            width: '40px',
            height: '4px',
            backgroundColor: '#E5E7EB',
            borderRadius: '2px',
            margin: '0 auto 16px auto'
          }}></div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main)', display: 'block' }}>
                {getCommonAreaName(selectedMapTalents.talents.map(t => t.locationName || ''))}
              </span>
              <span style={{ fontSize: '12px', color: '#10B981', fontWeight: 'bold' }}>
                対応可能な人材: {selectedMapTalents.talents.length}名
              </span>
            </div>
            <button 
              onClick={() => setSelectedMapTalents(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-sub)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>close</span>
            </button>
          </div>

          <button 
            className="view-area-btn" 
            data-area={selectedMapTalents.locationName}
            onClick={() => {
              const areaName = selectedMapTalents.locationName;
              if (areaName.includes('渋谷')) setFilterArea('shibuya');
              else if (areaName.includes('新宿')) setFilterArea('shinjuku');
              else if (areaName.includes('池袋') || areaName.includes('豊島')) setFilterArea('ikebukuro');
              else setFilterArea('all');
              setViewMode('list');
              setSelectedMapTalents(null);
            }}
            style={{ 
              width: '100%', 
              padding: '12px', 
              background: '#10B981', 
              color: 'white', 
              border: 'none', 
              borderRadius: '10px', 
              cursor: 'pointer', 
              fontWeight: 'bold', 
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 4px 12px rgba(16,185,129,0.2)'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>list</span>
            このエリアの人材リストを表示
          </button>
        </div>
      )}

      <div className="fab-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <button 
          className="fab-main" 
          onClick={() => setIsCsvModalOpen(true)}
          style={{ width: '40px', height: '40px', background: '#3B82F6' }}
          title="CSV一括登録"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>upload_file</span>
        </button>
        <button className="fab-main" onClick={handleOpenCreateForm}>
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>

      {isCsvModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCsvModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: '24px', maxWidth: csvPreviewData ? '600px' : '400px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>CSV一括登録</h2>
            
            {csvPreviewData ? (
              <>
                <p style={{ fontSize: '14px', marginBottom: '16px' }}>
                  {csvPreviewData.data.length}件のデータを読み込みました。
                  {csvPreviewData.errors.length > 0 && <span style={{ color: '#EF4444', fontWeight: 'bold', marginLeft: '8px' }}>{csvPreviewData.errors.length}件のエラーがあります。</span>}
                </p>

                <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--bg-gray)', position: 'sticky', top: 0 }}>
                      <tr>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>行</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>{mode === 'job' ? '案件名' : '人材名'}</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>単価</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>エラー</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewData.data.map((item, idx) => {
                        const rowIndex = idx + 1; // header is 0
                        const rowError = csvPreviewData.errors.find(e => e.rowIndex === rowIndex);
                        return (
                          <tr key={idx} style={{ background: rowError ? '#FEE2E2' : 'transparent', borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '8px' }}>{rowIndex}</td>
                            <td style={{ padding: '8px' }}>{mode === 'job' ? (item as Job).title : (item as Talent).name}</td>
                            <td style={{ padding: '8px' }}>{item.price}</td>
                            <td style={{ padding: '8px', color: '#EF4444' }}>{rowError?.message}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button className="btn-outline" onClick={() => setCsvPreviewData(null)}>やり直す</button>
                  <button 
                    className="btn-primary" 
                    onClick={handleConfirmCsvRegistration}
                    disabled={csvPreviewData.errors.length > 0}
                    style={{ opacity: csvPreviewData.errors.length > 0 ? 0.5 : 1, cursor: csvPreviewData.errors.length > 0 ? 'not-allowed' : 'pointer' }}
                  >
                    この内容で登録
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-sub)', marginBottom: '16px' }}>
                  テンプレートをダウンロードし、データを入力してからアップロードしてください。<br/>
                  ※座標はダミー値が自動入力されます。
                </p>
                <button 
                  onClick={downloadCsvTemplate}
                  className="btn-outline" 
                  style={{ width: '100%', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>download</span>
                  テンプレートをダウンロード
                </button>
                <label 
                  className="btn-primary" 
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload</span>
                  CSVファイルを選択
                  <input 
                    type="file" 
                    accept=".csv" 
                    style={{ display: 'none' }} 
                    onChange={handleCsvFileUpload}
                  />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                  <button className="btn-outline" onClick={() => setIsCsvModalOpen(false)}>閉じる</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* 一括スカウトフローティングバー */}
      {mode === 'talent' && selectedTalentIds.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0F172A',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '30px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
          zIndex: 9999
        }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
            {selectedTalentIds.length} 名を選択中
          </span>
          <button
            onClick={() => setShowBulkScoutModal(true)}
            style={{
              background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
            一括スカウト送信
          </button>
          <button
            onClick={() => setSelectedTalentIds([])}
            style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '12px' }}
          >
            解除
          </button>
        </div>
      )}

      {/* 一括スカウト作成モーダル */}
      {showBulkScoutModal && (
        <div className="modal-overlay" onClick={() => setShowBulkScoutModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: '24px', maxWidth: '480px' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
              <span className="material-symbols-outlined" style={{ color: '#6366F1' }}>send</span>
              一括スカウト送信 ({selectedTalentIds.length}名)
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '16px', lineHeight: '1.5' }}>
              選択した {selectedTalentIds.length} 名の人材へ個別のメッセージチャットルームを開設し、一括でスカウトメッセージを送信します。
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '6px', color: 'var(--text-main)' }}>スカウトメッセージ本文</label>
              <textarea 
                rows={5}
                value={bulkScoutMessage}
                onChange={e => setBulkScoutMessage(e.target.value)}
                style={{ width: '100%', borderRadius: '8px', border: '1px solid #CBD5E1', padding: '10px', fontSize: '13px', lineHeight: '1.5' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setShowBulkScoutModal(false)}>キャンセル</button>
              <button 
                onClick={handleSendBulkScout}
                style={{
                  background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                一括送信する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
