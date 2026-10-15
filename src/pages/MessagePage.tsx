import { useState, useRef, useEffect, useMemo } from 'react';
import { api, subscribeToContractTaskChanges } from '../data/mockDb';
import { getEngagementStatusLabel } from '../utils/statusLabels';
import { getOpponentCompanyName } from '../utils/chatParties';
import { getExpenseCategoryLabel } from '../utils/expenseHelpers';
import { getOfferExpiryState } from '../utils/offerExpiry';
import { getPrimaryLinkedJobId, isJobLinkedToChat, getJobStaffId, getLinkedStaffIds } from '../utils/jobStates';
import { isGroupChat as isGroupChatTask, isDirectChat as isDirectChatTask } from '../utils/contractTaskKind';
import { getAddedMembers, getAddedMemberStaffIds, getHistoryCutoffMsgId } from '../utils/chatMembers';
import type { AddedChatMember } from '../utils/chatMembers';
import { getSbSubcontractApproval, requiresSbSubcontractApproval, validateSbSubcontractApproval } from '../utils/sbSubcontractApproval';

// チャットのステータスバッジ。レガシーなチャット状態(商談中/契約待ち等)は個別に、
// 応募・契約ステータスは getEngagementStatusLabel に委譲する(STATUS_MODEL.md §4)。
function getChannelBadge(
  status: string | undefined,
  job: Parameters<typeof getEngagementStatusLabel>[1],
  opts: { viewer?: 'client' | 'agency'; contractApproved?: boolean } = {},
): { label: string; color: string; bg: string } {
  switch (status) {
    case 'group': return { label: '現場グループ', color: '#7C2D12', bg: '#FDBA74' };
    case 'negotiating': return { label: '商談中', color: '#3730A3', bg: '#E0E7FF' };
    case 'waiting': return { label: '契約待ち', color: '#9A3412', bg: '#FFEDD5' };
    case 'contracted': return { label: '契約成立', color: '#065F46', bg: '#D1FAE5' };
    default: {
      const e = getEngagementStatusLabel(status || '', job, opts);
      return { label: e.label, color: e.color, bg: e.bg };
    }
  }
}

interface ChatChannel {
  id: string;
  name: string;
  title: string;
  status: 'negotiating' | 'waiting' | 'contracted' | 'group' | 'applying' | 'offered' | 'rejected' | 'declined' | 'confirmed' | 'report_pending' | 'completed' | 'disputed' | 'cancelled';
  avatar: string;
  avatarBg: string;
  preview: string;
  time: string;
  members?: string[];
  companyGroupName?: string;
  isUnread?: boolean;
}

const photoOptions = [
  {
    id: 'p1',
    label: '現場の状況（開始前）',
    url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80'
  },
  {
    id: 'p2',
    label: '業務中の様子',
    url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80'
  },
  {
    id: 'p3',
    label: '作業完了時の状況',
    url: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=600&q=80'
  },
  {
    id: 'p4',
    label: 'スタッフ・ミーティング',
    url: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=600&q=80'
  }
];


export function MessagePage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const chatTimelineRef = useRef<HTMLDivElement>(null);
  const prevActiveChatIdRef = useRef<string | null>(null);
  const prevMessagesCountRef = useRef<number>(0);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [chatTasks, setChatTasks] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [allStaffs, setAllStaffs] = useState<any[]>([]);

  // サイドバー検索・アコーディオン用のState
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [chatTypeFilter, setChatTypeFilter] = useState<'all' | 'admin' | 'staff'>('all');
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});

  // 経費・手配用のState
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showArrangementModal, setShowArrangementModal] = useState(false);

  // 内定通知表示用のState
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [selectedOfferMsg, setSelectedOfferMsg] = useState<any>(null);
  const [confirmingOfferAction, setConfirmingOfferAction] = useState<'accept' | 'decline' | null>(null);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showAddMemberPanel, setShowAddMemberPanel] = useState(false);
  const [addMemberSelection, setAddMemberSelection] = useState<Set<string>>(new Set());
  const [addMemberShareHistory, setAddMemberShareHistory] = useState(true);
  const [addingMembers, setAddingMembers] = useState(false);
  const [removingStaffId, setRemovingStaffId] = useState<string | null>(null);

  const [receiptCategory, setReceiptCategory] = useState<'transport' | 'accommodation' | 'car'>('transport');
  const [receiptAmount, setReceiptAmount] = useState<number>(0);
  const [receiptItem, setReceiptItem] = useState('');
  const [receiptRoute, setReceiptRoute] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [showReceiptsListModal, setShowReceiptsListModal] = useState(false);
  const [arrangementCategory, setArrangementCategory] = useState<'transport' | 'accommodation'>('transport');
  const [arrangementInfo, setArrangementInfo] = useState('');
  const [sendingOfferReminder, setSendingOfferReminder] = useState(false);

  // カテゴリーごとの追加フィールド用のState
  const [receiptHotelName, setReceiptHotelName] = useState('');
  const [receiptNights, setReceiptNights] = useState('');
  const [receiptDistance, setReceiptDistance] = useState<number | ''>('');
  const [receiptGasolineRate, setReceiptGasolineRate] = useState<number>(15);
  const [receiptExpressway, setReceiptExpressway] = useState<number | ''>('');
  const [receiptParking, setReceiptParking] = useState<number | ''>('');

  useEffect(() => {
    if (receiptCategory === 'car') {
      const distance = Number(receiptDistance) || 0;
      const rate = Number(receiptGasolineRate) || 0;
      const gas = Math.round(distance * rate);
      const expressway = Number(receiptExpressway) || 0;
      const parking = Number(receiptParking) || 0;
      setReceiptAmount(gas + expressway + parking);
    }
  }, [receiptCategory, receiptDistance, receiptGasolineRate, receiptExpressway, receiptParking]);

  const isReceiptSubmitDisabled = useMemo(() => {
    if (!receiptItem.trim()) return true;
    if (receiptCategory === 'car') {
      return !receiptDistance || Number(receiptDistance) <= 0;
    }
    return !receiptAmount || Number(receiptAmount) <= 0;
  }, [receiptCategory, receiptItem, receiptDistance, receiptAmount]);

  // 条件編集用のState
  const [showEditConditionsModal, setShowEditConditionsModal] = useState(false);
  const [editConditionsPrice, setEditConditionsPrice] = useState<number>(0);
  const [editConditionsDate, setEditConditionsDate] = useState('');

  // 業務委託契約の承認・詳細プロフィールのState
  const [showContractModal, setShowContractModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [clickedCompanyProfile, setClickedCompanyProfile] = useState<any | null>(null);
  const [clickedStaffProfile, setClickedStaffProfile] = useState<any | null>(null);
  const [allTrainings, setAllTrainings] = useState<any[]>([]);

  useEffect(() => {
    api.getTrainings().then(setAllTrainings);
  }, []);

  // メニュー・定型文・写真用のState
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoCaption, setPhotoCaption] = useState('');
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState('');
  const [selectedPhotoName, setSelectedPhotoName] = useState('');

  // 定型文テンプレートModal用のState
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const defaultChatTemplates = [
    'お世話になっております。業務内容および条件を確認いたしました。どうぞよろしくお願いいたします。',
    '本日の案件にご応募いただきありがとうございます。詳細条件につきまして確認させていただきます。',
    '現場に到着いたしました。これより準備および業務を開始いたします。',
    '本日の業務がすべて完了いたしました。完了報告と相互評価を送信いたしますのでご確認ください。',
    '経費の領収書を添付・申請いたしました。ご確認のほどよろしくお願いいたします。'
  ];
  const [customTemplates, setCustomTemplates] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('connexy_chat_templates') || '[]');
    } catch (e) { return []; }
  });
  const [newTemplateInput, setNewTemplateInput] = useState('');

  // 電子サインModal用のState
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [pendingProposalMsgId, setPendingProposalMsgId] = useState<string | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSignature, setIsDrawingSignature] = useState(false);

  const handleSync = async () => {
    try {
      const tasks = await api.getContractTasks();
      setChatTasks(tasks);
      const fetchedJobs = await api.getJobs();
      setJobs(fetchedJobs);
    } catch (err) {
      console.error('Manual sync failed:', err);
    }
  };

  useEffect(() => {
    const initData = async () => {
      const u = await api.getCurrentUser();
      setCurrentUser(u);

      const users = await api.getUsers();
      setAllCompanies(users);

      const tasks = await api.getContractTasks();
      setChatTasks(tasks);

      const fetchedJobs = await api.getJobs();
      setJobs(fetchedJobs);

      const staffs = await api.getAllStaffs();
      setAllStaffs(staffs);

      // Check if there is an active chat room saved in local storage to open
      const savedActiveId = localStorage.getItem('connexy_active_chat_id');
      if (savedActiveId) {
        setActiveChatId(savedActiveId);
        window.history.pushState({ activeChatId: savedActiveId }, '');
        localStorage.removeItem('connexy_active_chat_id');
      }
    };
    initData();
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const stateId = event.state?.activeChatId || null;
      setActiveChatId(stateId);
    };
    window.addEventListener('popstate', handlePopState);

    if (window.history.state?.activeChatId) {
      setActiveChatId(window.history.state.activeChatId);
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    const refresh = async () => {
      try {
        setChatTasks(await api.getContractTasks());
        setJobs(await api.getJobs());
        setAllStaffs(await api.getAllStaffs());
      } catch (err) {
        console.error('Chat refresh error:', err);
      }
    };
    // データ変更イベント + Realtime + フォールバックポーリング(subscribe 側が間隔を管理)。
    const unsubscribe = subscribeToContractTaskChanges(refresh);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const maskContactInfo = (text: string) => {
    if (activeChat?.status === 'contracted' || activeChat?.status === 'confirmed' || (activeChat?.status as any) === 'completed' || activeChat?.status === 'group') return text;
    let masked = text;
    // Email addresses
    masked = masked.replace(/[a-zA-Z0-9_.+-]+[\s　]*@[\s　]*[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[連絡先はマッチング完了まで非公開です]');
    // Phone numbers (with or without hyphens/spaces, matching 10-11 digits; also matches +81 country-code mobile format)
    masked = masked.replace(/(?:(?:\+81[-\s　]?)?0?[789]0[-\s　]?\d{4}[-\s　]?\d{4}|0\d{1,4}[-\s　]?\d{1,4}[-\s　]?\d{3,4})/g, '[連絡先はマッチング完了まで非公開です]');
    // LINE ID and Links
    masked = masked.replace(/(?:line\.me\/\S+|(?:LINE|ライン)\s*ID\s*[:：]?\s*[a-zA-Z0-9_.-]+)/gi, '[連絡先はマッチング完了まで非公開です]');
    return masked;
  };

  const getDefaultMessages = (chatId: string) => {
    if (chatId === 'chat_au_group') {
      return [
        { id: 'def_1', type: 'system', text: '現場グループチャットが開設されました', time: '昨日' },
        { id: 'def_2', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信_担当者', text: 'お疲れ様です。明日のauショップ新宿西口店イベント、メンバー確定しましたのでグループ作成しました。集合時間は9:30、店舗裏口です。よろしくお願いいたします！', time: '昨日 18:00', avatar: 'ア' },
        { id: 'def_3', type: 'received', senderId: 'beta', senderName: 'ベータエージェンシー_佐藤さん', text: '佐藤です。承知いたしました。明日はよろしくお願いいたします！', time: '昨日 18:10', avatar: '佐' },
        { id: 'def_4', type: 'received', senderId: 'beta', senderName: 'ベータエージェンシー_田中さん', text: '田中です。承知いたしました。よろしくお願いいたします！', time: '昨日 18:15', avatar: '田' }
      ];
    }
    if (chatId === 'chat_alpha_sigma') {
      return [
        { id: 'def_11', type: 'system', text: 'チャットを開始しました', time: '' },
        { id: 'def_12', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信', text: 'お世話になっております。週末のキャンペーンスタッフ2名の件ですが、まだ募集されていますでしょうか？', time: '10:30', avatar: 'A' },
        { id: 'def_13', type: 'sent', senderId: currentUser?.id === 'alpha' ? 'sigma' : 'alpha', text: 'お世話になっております！はい、まだ募集しております。\n単価15,000円でお願いしたいのですが、いかがでしょうか？', time: '10:35' },
        { id: 'def_14', type: 'received', senderId: 'alpha', senderName: '株式会社アルファ通信', text: '明日の待ち合わせ時間は10時でお願いします。', time: '10:42', avatar: 'A' }
      ];
    }
    if (chatId === 'chat_beta_sigma') {
      return [
        { id: 'def_21', type: 'system', text: 'チャットを開始しました', time: '' },
        { id: 'def_22', type: 'received', senderId: 'beta', senderName: 'ベータエージェンシー', text: '発注書を発行しました。ご確認お願いします。', time: '昨日', avatar: 'B' }
      ];
    }
    if (chatId === 'chat_gamma_sigma') {
      return [
        { id: 'def_31', type: 'system', text: 'チャットを開始しました', time: '' },
        { id: 'def_32', type: 'received', senderId: 'gamma', senderName: 'ガンマモバイル', text: 'よろしくお願いします。', time: '月曜日', avatar: 'G' }
      ];
    }
    return [
      { id: 'def_41', type: 'system', text: 'チャットを開始しました', time: '' }
    ];
  };

  const channels = useMemo(() => {
    if (!currentUser) return [];

    const isStaffUser = !!currentUser.staffId && currentUser.staffRole !== 'admin';

    // 1. Static Group chat channel (Mock compatibility)
    const groupChannel: ChatChannel = {
      id: 'chat_au_group',
      name: '【グループ】auショップ新宿西口店 現場連絡',
      title: 'auショップ新宿西口店 イベント',
      status: 'group',
      avatar: '協',
      avatarBg: 'bg-orange',
      preview: '明日はよろしくお願いします！',
      time: '18:15',
      members: [
        '株式会社アルファ通信_担当者',
        'ベータエージェンシー_鈴木さん',
        'ベータエージェンシー_佐藤さん',
        'ベータエージェンシー_田中さん'
      ],
      companyGroupName: '現場グループチャット'
    };

    const groupTask = chatTasks.find(t => t.id === 'chat_au_group');
    const groupMessages = (groupTask?.evaluations as any)?.messages || getDefaultMessages('chat_au_group');
    if (groupMessages.length > 0) {
      const lastGroupMsg = groupMessages[groupMessages.length - 1];
      if (lastGroupMsg) {
        groupChannel.preview = lastGroupMsg.type === 'system' ? lastGroupMsg.text : lastGroupMsg.text;
        groupChannel.time = lastGroupMsg.time || '';
        
        const isSystem = lastGroupMsg.type === 'system';
        const isNotMe = lastGroupMsg.senderId !== currentUser.id;
        if (isSystem || isNotMe) {
          const lastReadId = localStorage.getItem('connexy_last_read_msg_chat_au_group');
          groupChannel.isUnread = lastReadId !== lastGroupMsg.id;
        }
      }
    }

    // 2. Dynamic Group chat channels from Supabase
    const dynamicGroupChannels: ChatChannel[] = chatTasks
      .filter(t => t.id.startsWith('chat_group_')) // 動的グループのみ(chat_au_group は別途固定チャンネルで扱う)
      .map(task => {
        const evaluations = task.evaluations || {};
        const assignedStaffIds = evaluations.assignedStaffIds || [];

        // Access Control for Staff User
        if (isStaffUser && !assignedStaffIds.includes(currentUser.staffId)) {
          return null; // This staff member is not assigned to this group
        }

        // Access Control for Admin User
        const parsedParts = task.id.split('_'); // ['chat', 'group', jobId, companyId]
        const jobId = parsedParts[2];
        const companyId = parsedParts[3];

        const job = jobs.find(j => j.id === jobId);
        const isClient = currentUser.id === job?.authorId;
        const isAgency = currentUser.id === companyId;

        // Admins must belong to either client or agency for this chat
        if (!isStaffUser && !isClient && !isAgency) {
          return null;
        }

        const taskMessages = evaluations.messages || [];
        const lastMsg = taskMessages.length > 0 ? taskMessages[taskMessages.length - 1] : null;
        let preview = '現場グループチャットが開設されました';
        let time = '';
        let isUnread = false;
        if (lastMsg) {
          preview = lastMsg.type === 'system' ? lastMsg.text : lastMsg.text;
          time = lastMsg.time || '';
          
          const isSystem = lastMsg.type === 'system';
          const isNotMe = lastMsg.senderId !== currentUser.id;
          if (isSystem || isNotMe) {
            const lastReadId = localStorage.getItem('connexy_last_read_msg_' + task.id);
            isUnread = lastReadId !== lastMsg.id;
          }
        } else {
          const lastReadId = localStorage.getItem('connexy_last_read_msg_' + task.id);
          isUnread = lastReadId !== 'created';
        }

        // Resolve staff names for member list
        const staffsInThisGroup = allStaffs.filter(s => assignedStaffIds.includes(s.id));
        const staffNames = staffsInThisGroup.map(s => `${s.name}さん`);
        const agencyCompany = allCompanies.find(c => c.id === companyId);
        const clientCompany = allCompanies.find(c => c.id === job?.authorId);

        const members = [
          `${clientCompany?.name || '元請け'}_担当者`,
          `${agencyCompany?.name || '下請け'}_担当者`,
          ...staffNames
        ];

        // Determine company name for accordion categorization
        const opponentCompany = isStaffUser ? clientCompany : (isClient ? agencyCompany : clientCompany);
        const companyGroupName = opponentCompany?.name || '現場グループチャット';

        return {
          id: task.id,
          name: `【グループ】${task.jobTitle} - ${agencyCompany?.name || 'パートナー会社'} 現場連絡`,
          title: task.jobTitle,
          status: 'group',
          avatar: '協',
          avatarBg: 'bg-orange',
          preview,
          time,
          members,
          companyGroupName,
          isUnread
        } as ChatChannel;
      })
      .filter((c): c is ChatChannel => c !== null);

    // 3. Direct channels with all other companies (Admins only, or Staff if they are assigned/involved)
    const directChannels = allCompanies
      .filter(c => c.id !== currentUser.id)
      .map(c => {
        const sortedIds = [currentUser.id, c.id].sort();
        const channelId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
        
        // Find existing contract task for this chat
        const task = chatTasks.find(t => t.id === channelId);
        const taskMessages = (task?.evaluations as any)?.messages || [];
        
        // Find default messages if database has none
        const msgs = taskMessages.length > 0 ? taskMessages : getDefaultMessages(channelId);
        
        // Last message info
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        let preview = 'チャットを開始しました';
        let time = '';
        let isUnread = false;
        if (lastMsg) {
          if (lastMsg.type === 'system') {
            preview = lastMsg.text;
          } else if (lastMsg.isProposal) {
            preview = '電子発注書が発行されました';
          } else {
            preview = lastMsg.text;
          }
          time = lastMsg.time || '';
          
          const isSystem = lastMsg.type === 'system';
          const isNotMe = lastMsg.senderId !== currentUser.id;
          if (isSystem || isNotMe) {
            const lastReadId = localStorage.getItem('connexy_last_read_msg_' + channelId);
            isUnread = lastReadId !== lastMsg.id;
          }
        }

        // Determine status dynamically
        let status: ChatChannel['status'] = 'negotiating';
        if (task) {
          status = task.status;
        } else {
          const proposal = msgs.find((m: any) => m.isProposal);
          if (proposal) {
            status = proposal.proposalStatus === 'approved' ? 'contracted' : 'waiting';
          }
        }

        // Predefined avatar mapping
        let avatar = c.name.substring(0, 1);
        let avatarBg = 'bg-blue';
        if (c.id === 'alpha') { avatar = 'A'; avatarBg = 'bg-blue'; }
        else if (c.id === 'beta') { avatar = 'B'; avatarBg = 'bg-green'; }
        else if (c.id === 'gamma') { avatar = 'G'; avatarBg = 'bg-purple'; }
        else if (c.id === 'delta') { avatar = 'D'; avatarBg = 'bg-red'; }
        else if (c.id === 'sigma') { avatar = 'S'; avatarBg = 'bg-teal'; }

        // Find a title or make default
        const title = task?.jobTitle || (
          c.id === 'alpha' ? '週末キャンペーンスタッフ2名' :
          c.id === 'beta' ? '光回線クローザー募集' :
          c.id === 'gamma' ? 'ドコモショップ応援（3日間）' :
          '直接契約・商談チャット'
        );

        return {
          id: channelId,
          name: c.name,
          title,
          status,
          avatar,
          avatarBg,
          preview,
          time,
          companyGroupName: c.name,
          isUnread
        } as ChatChannel;
      })
      .filter(channel => {
        const isDefaultMockRoom = 
          channel.id === 'chat_alpha_sigma' || 
          channel.id === 'chat_beta_sigma' || 
          channel.id === 'chat_gamma_sigma';
        const existsInDb = chatTasks.some(t => t.id === channel.id);
        const isRequestedActiveChat = channel.id === activeChatId;

        // If it's a regular staff user, restrict direct channels
        if (isStaffUser) {
          if (isRequestedActiveChat) return true;
          const task = chatTasks.find(t => t.id === channel.id);
          if (task && getLinkedStaffIds(task.evaluations).includes(currentUser.staffId)) return true;
          // このチャットに「メンバー追加」で参加している自社スタッフ
          if (task && getAddedMemberStaffIds(task.evaluations).includes(currentUser.staffId)) return true;
          return false;
        }

        return isDefaultMockRoom || existsInDb || isRequestedActiveChat;
      });

    // For staff users, also allow access to the mock group chat for demonstration if applicable
    const showMockGroupChat = ['sigma', 'alpha', 'beta'].includes(currentUser.id);
    const allowedGroupChannels = showMockGroupChat 
      ? [groupChannel, ...dynamicGroupChannels] 
      : dynamicGroupChannels;

    return [...allowedGroupChannels, ...directChannels];
  }, [currentUser, allCompanies, chatTasks, jobs, allStaffs, activeChatId]);

  const filteredChannels = useMemo(() => {
    return channels.filter(c => {
      // 1. Search keyword matching (case-insensitive)
      if (sidebarSearch.trim() !== '') {
        const kw = sidebarSearch.toLowerCase();
        const nameMatch = c.name?.toLowerCase().includes(kw);
        const titleMatch = c.title?.toLowerCase().includes(kw);
        const previewMatch = c.preview?.toLowerCase().includes(kw);
        if (!nameMatch && !titleMatch && !previewMatch) {
          return false;
        }
      }

      // 2. Chat type filter matching
      const isGroupChat = c.status === 'group' || isGroupChatTask(c);

      if (chatTypeFilter === 'admin' && isGroupChat) return false;
      if (chatTypeFilter === 'staff' && !isGroupChat) return false;

      return true;
    });
  }, [channels, sidebarSearch, chatTypeFilter]);

  const groupedChannels = useMemo(() => {
    const groups: Record<string, ChatChannel[]> = {};
    filteredChannels.forEach(c => {
      let groupName = c.companyGroupName || c.name;
      if (c.id === 'chat_au_group') {
        groupName = '現場グループチャット';
      }
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(c);
    });
    return groups;
  }, [filteredChannels]);

  const activeChat = useMemo(() => {
    if (!activeChatId) return null;
    return channels.find(c => c.id === activeChatId) || null;
  }, [activeChatId, channels]);

  const messages = useMemo(() => {
    if (!activeChat) return [];
    const task = chatTasks.find(t => t.id === activeChat.id);
    const taskMessages = (task?.evaluations as any)?.messages;
    let list: any[];
    if (taskMessages && Array.isArray(taskMessages) && taskMessages.length > 0) {
      list = taskMessages;
    } else {
      list = getDefaultMessages(activeChat.id);
    }
    // 「過去のトーク非共有」で追加された担当者には、参加時点より前のメッセージを見せない
    const cutoffId = getHistoryCutoffMsgId(task?.evaluations, currentUser?.staffId);
    if (cutoffId) {
      const idx = list.findIndex((m: any) => m && m.id === cutoffId);
      if (idx >= 0) list = list.slice(idx + 1);
    }
    return list;
  }, [activeChat, chatTasks, currentUser]);

  // チャットに関連する案件情報の解決
  const relatedJob = useMemo(() => {
    if (!activeChat || !chatTasks) return null;
    const task = chatTasks.find(t => t.id === activeChat.id);
    const jobId = getPrimaryLinkedJobId(task?.evaluations);
    if (!jobId) return null;
    return jobs.find(j => j.id === jobId) || null;
  }, [activeChat, chatTasks, jobs]);

  const relatedTask = useMemo(() => {
    if (!activeChat) return null;
    return chatTasks.find(t => t.id === activeChat.id) || null;
  }, [activeChat, chatTasks]);

  // 内定オファーの有効期限。offered 状態のときのみ意味を持つ。
  const offerExpiry = useMemo(
    () => getOfferExpiryState((relatedTask?.evaluations as any) || null),
    [relatedTask],
  );

  const contractApproved = useMemo(() => {
    if (!relatedTask) return true;
    const isJobMatch = relatedTask.jobId && relatedTask.jobId !== 'chat';
    if (!isJobMatch) return true;
    const clientOk = relatedTask.clientContractApprovedByClient && relatedTask.clientContractApprovedByAgency;
    const agencyOk = !relatedTask.agencyContractText || (relatedTask.agencyContractApprovedByClient && relatedTask.agencyContractApprovedByAgency);
    return !!(clientOk && agencyOk);
  }, [relatedTask]);

  const workDateNear = useMemo(() => {
    if (!relatedTask || !relatedTask.date) return false;
    const workDate = new Date(relatedTask.date);
    const today = new Date();
    workDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffDays = (workDate.getTime() - today.getTime()) / (1000 * 3600 * 24);
    return diffDays >= 0 && diffDays <= 2;
  }, [relatedTask]);

  const isClient = useMemo(() => {
    if (!currentUser) return false;
    if (relatedJob) {
      return currentUser.id === relatedJob.authorId || currentUser.id === (relatedJob as any).companyId;
    }
    // No linked job (e.g. a talent-scout-initiated chat) — fall back to the
    // client name recorded when the chat/task was created.
    if (relatedTask) {
      return currentUser.name === relatedTask.clientName;
    }
    return false;
  }, [currentUser, relatedJob, relatedTask]);

  const sbApprovalGate = useMemo(() => {
    if (!requiresSbSubcontractApproval(relatedJob)) {
      return { required: false, valid: true, record: undefined, reason: undefined };
    }
    const jobId = relatedJob?.id;
    const staffId = jobId ? getJobStaffId(relatedTask?.evaluations, jobId) : undefined;
    const record = getSbSubcontractApproval(relatedTask, jobId);
    const result = validateSbSubcontractApproval(record, {
      agencyId: relatedTask?.agency_id || (!isClient ? currentUser?.id : undefined),
      staffId,
    });
    return { required: true, ...result, record };
  }, [relatedJob, relatedTask, isClient, currentUser]);

  const clientName = useMemo(() => {
    if (!activeChat || !chatTasks) return '元請け企業';
    const task = chatTasks.find(t => t.id === activeChat.id);
    return task?.clientName || '元請け企業';
  }, [activeChat, chatTasks]);

  interface MemberEntry { label: string; person: string; companyId?: string; removableStaffId?: string; role?: 'admin' | 'staff'; isAnchor?: boolean; }

  const activeMembers = useMemo<MemberEntry[]>(() => {
    if (!activeChat) return [];
    if (activeChat.members && activeChat.members.length > 0) {
      return activeChat.members.map((s: string) => ({ label: s.replace('_', ' '), person: s.split('_').slice(1).join(' ') || s }));
    }

    // 直接チャット: `chat_<会社A>_<会社B>` の2社それぞれで、
    // 「実際にこのチャットに関与している担当者」を割り出す。
    const parts = activeChat.id.split('_');
    const compIds = [parts[1], parts[2]].filter(Boolean);
    const task = chatTasks.find(t => t.id === activeChat.id);
    const jobId = relatedJob?.id || getPrimaryLinkedJobId(task?.evaluations) || '';
    const appliedStaffId = task ? getJobStaffId(task.evaluations, jobId) : undefined;
    const appliedStaff = allStaffs.find(s => s.id === appliedStaffId);
    const added = getAddedMembers(task?.evaluations);

    const out: MemberEntry[] = [];
    for (const cid of compIds) {
      const comp = allCompanies.find(c => c.id === cid);
      const compName = comp?.name || cid;
      // name -> removableStaffId (「メンバー追加」で参加した担当者のみ removable)
      const people = new Map<string, string | undefined>();
      const addName = (name: string, removableStaffId?: string) => {
        if (!name) return;
        if (!people.has(name) || (removableStaffId && !people.get(name))) people.set(name, removableStaffId);
      };

      // 1. このチャットでメッセージを送った担当者(senderName = "会社名_個人名")
      const senders: string[] = [];
      messages.forEach((m: any) => {
        const sn = m.senderName ? String(m.senderName) : '';
        const i = sn.indexOf('_');
        if (i > 0 && sn.slice(0, i) === compName) {
          const person = sn.slice(i + 1).trim();
          if (person && person !== '代表' && person !== '担当者') { addName(person); senders.push(person); }
        }
      });
      // 2. 応募時に提案されたスタッフ(応募側の会社)
      if (appliedStaff && appliedStaff.userId === cid) addName(appliedStaff.name);
      // 3. ログイン中の自分がこの会社なら、自分の担当者名
      if (currentUser?.id === cid && currentUser.staffName) addName(currentUser.staffName);
      // 4. 「メンバー追加」で参加した自社担当者(こちらは削除可能)
      added.forEach(m => { if (m.companyId === cid && m.name) addName(m.name, m.staffId); });
      // 5. 誰も特定できなければ会社の代表者
      if (people.size === 0 && comp?.representativeName) addName(comp.representativeName);

      // トークルーム開始時の「各社1名」= だれであっても削除不可(応募スタッフ / 最初の発言者 / 代表者)
      const anchorName =
        (appliedStaff && appliedStaff.userId === cid ? appliedStaff.name : '')
        || senders[0]
        || comp?.representativeName
        || '';

      if (people.size === 0) {
        out.push({ label: compName, person: '', companyId: cid, isAnchor: true });
      } else {
        people.forEach((removableStaffId, p) => {
          const staff = removableStaffId ? allStaffs.find(s => s.id === removableStaffId) : undefined;
          out.push({
            label: `${compName} ${p}`,
            person: p,
            companyId: cid,
            removableStaffId,
            role: staff?.role,
            isAnchor: p === anchorName,
          });
        });
      }
    }
    return out;
  }, [activeChat, currentUser, messages, chatTasks, allCompanies, allStaffs, relatedJob]);

  // 自社の人間でまだこのチャットに参加していない担当者(メンバー追加の候補)
  const addableStaffs = useMemo(() => {
    if (!activeChat || !currentUser || activeChat.status === 'group') return [];
    // 直接チャットで、自分がこのチャットの2社のいずれかに属している場合のみ
    const compIds = activeChat.id.split('_').slice(1, 3);
    if (!compIds.includes(currentUser.id)) return [];
    const memberNames = new Set(activeMembers.map(m => m.person).filter(Boolean));
    return allStaffs.filter(s =>
      s.userId === currentUser.id
      && s.id !== currentUser.staffId
      && !memberNames.has(s.name),
    );
  }, [activeChat, currentUser, allStaffs, activeMembers]);

  // 送信時の senderName と同じ形式("会社名_担当者名")。同じ会社の別担当者と自分を区別するのに使う。
  const mySenderName = useMemo(() => {
    if (!currentUser) return '';
    return currentUser.staffName ? `${currentUser.name}_${currentUser.staffName}` : `${currentUser.name}_代表`;
  }, [currentUser]);

  const mappedMessages = useMemo(() => {
    return messages.map((msg: any) => {
      const isOffer = msg.isOffer || (msg.id && msg.id.startsWith('sys_offer_') && (msg.text?.includes('内定') || msg.isOffer));
      if (msg.type === 'system' && !isOffer) return msg;

      let type = msg.type;
      if (isOffer) {
        type = isClient ? 'sent' : 'received';
      } else if (typeof msg.senderName === 'string' && msg.senderName.includes('_') && mySenderName) {
        // "会社名_担当者" 形式なら担当者単位で自分/相手を判定(同じ会社の別担当者を取り違えない)
        type = msg.senderName === mySenderName ? 'sent' : 'received';
      } else if (msg.senderId) {
        type = (currentUser && msg.senderId === currentUser.id) ? 'sent' : 'received';
      }
      return {
        ...msg,
        type,
        isOffer
      };
    });
  }, [messages, currentUser, isClient, mySenderName]);

  const proposed = useMemo(() => {
    return messages.some((m: any) => m.isProposal);
  }, [messages]);

  const pendingReceiptsCount = useMemo(() => {
    return messages.filter((m: any) => m.isReceipt && m.receiptDetails?.status === 'pending').length;
  }, [messages]);

  // チャット閲覧・新規メッセージ受信時に既読（最後に閲覧したメッセージ）として登録する
  useEffect(() => {
    if (!activeChatId) return;
    if (messages && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.id) {
        localStorage.setItem('connexy_last_read_msg_' + activeChatId, lastMsg.id);
      }
    }
  }, [activeChatId, messages]);

  useEffect(() => {
    if (!chatTimelineRef.current) return;
    const container = chatTimelineRef.current;
    
    // Check if chat ID changed
    const currentChatId = activeChat?.id || null;
    const isChatChanged = prevActiveChatIdRef.current !== currentChatId;
    prevActiveChatIdRef.current = currentChatId;

    // Check if message count increased
    const currentCount = mappedMessages.length;
    const isNewMessage = currentCount > prevMessagesCountRef.current;
    prevMessagesCountRef.current = currentCount;

    // Determine if user is scrolled near bottom
    // scrollHeight - scrollTop - clientHeight is the distance from the bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 100; // 100px threshold

    // If chat changed, we scroll to bottom.
    // If a new message arrived, we scroll to bottom only if the user was already near the bottom, or if the user sent it.
    if (isChatChanged) {
      container.scrollTop = container.scrollHeight;
    } else if (isNewMessage) {
      const lastMessage = mappedMessages[mappedMessages.length - 1];
      const sentByMe = lastMessage && lastMessage.senderId === currentUser?.id;
      if (isNearBottom || sentByMe) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [mappedMessages, activeChat, currentUser]);

  const handleAddMembers = async () => {
    if (!activeChat || !currentUser || addMemberSelection.size === 0) return;
    setAddingMembers(true);
    try {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const lastMsgId = messages.length ? messages[messages.length - 1]?.id ?? null : null;
      const selected = allStaffs.filter((s: any) => addMemberSelection.has(s.id));
      if (selected.length === 0) return;

      const newMembers: AddedChatMember[] = selected.map((s: any) => ({
        staffId: s.id,
        companyId: currentUser.id,
        name: s.name,
        addedByStaffId: currentUser.staffId,
        addedByName: currentUser.staffName || currentUser.representativeName || '担当者',
        addedAt: now.toISOString(),
        historyShared: addMemberShareHistory,
        joinAfterMsgId: addMemberShareHistory ? null : lastMsgId,
      }));

      const names = selected.map((s: any) => s.name).join('、');
      const adder = currentUser.staffName || currentUser.name;
      // 履歴を共有した場合のみ追記(要望どおり)
      const sysMsg = {
        id: `sys_member_add_${Date.now()}`,
        type: 'system',
        text: addMemberShareHistory
          ? `${adder}が ${names} を追加し、過去のトークを共有しました。`
          : `${adder}が ${names} を追加しました。`,
        time: timeStr,
      };

      await api.addChatMembers(activeChat.id, newMembers, [sysMsg]);
      setChatTasks(await api.getContractTasks());
      setAddMemberSelection(new Set());
      setShowAddMemberPanel(false);
      setAddMemberShareHistory(true);
    } catch (e) {
      console.error(e);
      alert('メンバーの追加に失敗しました。');
    } finally {
      setAddingMembers(false);
    }
  };

  const handleRemoveMember = async (staffId: string, name: string) => {
    if (!activeChat || !currentUser) return;
    if (!confirm(`${name} さんをこのトークから削除しますか？`)) return;
    setRemovingStaffId(staffId);
    try {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const remover = currentUser.staffName || currentUser.name;
      const sysMsg = {
        id: `sys_member_remove_${Date.now()}`,
        type: 'system',
        text: `${remover}が ${name} をトークから削除しました。`,
        time: timeStr,
      };
      await api.removeChatMembers(activeChat.id, [staffId], [sysMsg]);
      setChatTasks(await api.getContractTasks());
    } catch (e) {
      console.error(e);
      alert('メンバーの削除に失敗しました。');
    } finally {
      setRemovingStaffId(null);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || !activeChat || !currentUser) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const senderName = currentUser.staffName 
      ? `${currentUser.name}_${currentUser.staffName}` 
      : `${currentUser.name}_代表`;

    const newMsg = {
      id: 'msg_' + Date.now(),
      senderId: currentUser.id,
      senderName,
      text: inputText,
      time: timeStr
    };

    const updated = [...messages, newMsg];
    setInputText('');

    try {
      const otherUser = allCompanies.find(c => {
        const sortedIds = [currentUser.id, c.id].sort();
        const generatedId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
        return generatedId === activeChat.id;
      });
      const clientName = currentUser.name;
      const workerName = otherUser ? otherUser.name : '相手';
      const jobTitle = activeChat.title || '商談チャット';

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handlePropose = async () => {
    if (!activeChat || !currentUser) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const senderName = currentUser.staffName 
      ? `${currentUser.name}_${currentUser.staffName}` 
      : `${currentUser.name}_代表`;

    const newMsg1 = {
      id: 'sys_' + Date.now(),
      type: 'system',
      text: `${currentUser.name}が電子発注書を発行しました`,
      time: timeStr
    };

    const newMsg2 = {
      id: 'prop_' + Date.now(),
      senderId: currentUser.id,
      senderName,
      text: '[CONTRACT_MOCK]',
      time: timeStr,
      isProposal: true,
      proposalStatus: 'pending',
      proposalDetails: {
        title: activeChat.title || '契約提案',
        price: relatedJob ? `${relatedJob.price.toLocaleString()}円 / 日` : '15,000円 / 日',
        duration: relatedJob?.eventDate || '日付未定'
      }
    };

    const updated = [...messages, newMsg1, newMsg2];

    try {
      const otherUser = allCompanies.find(c => {
        const sortedIds = [currentUser.id, c.id].sort();
        const generatedId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
        return generatedId === activeChat.id;
      });
      const clientName = currentUser.name;
      const workerName = otherUser ? otherUser.name : '相手';
      const jobTitle = activeChat.title || '商談チャット';

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName, relatedJob ? [relatedJob.id] : undefined);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (err) {
      console.error('Failed to send proposal:', err);
    }
  };

  const handleSignContract = async () => {
    if (!relatedTask || !currentUser) return;
    const side = isClient ? 'client' : 'agency';
    try {
      await api.updateContractApproval(relatedTask.id, side, true);
      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
      alert('契約書に署名（承認）しました。');
    } catch (err) {
      console.error('Failed to sign contract:', err);
      alert('契約署名に失敗しました。');
    }
  };

  const handleAvatarClick = (msg: any) => {
    if (!msg || !msg.senderId || !currentUser) return;
    
    const foundCompany = allCompanies.find(c => c.id === msg.senderId);
    if (foundCompany) {
      setClickedCompanyProfile(foundCompany);
      setClickedStaffProfile(null);
      setShowProfileModal(true);
      return;
    }
    
    const foundStaff = allStaffs.find(s => s.id === msg.senderId);
    if (foundStaff) {
      setClickedStaffProfile(foundStaff);
      setClickedCompanyProfile(null);
      setShowProfileModal(true);
      return;
    }
    
    if (msg.senderName) {
      const cleanName = msg.senderName.split('_')[1] || msg.senderName.split('_')[0];
      const compByName = allCompanies.find(c => c.name.includes(cleanName) || cleanName.includes(c.name));
      if (compByName) {
        setClickedCompanyProfile(compByName);
        setClickedStaffProfile(null);
        setShowProfileModal(true);
        return;
      }
      const staffByName = allStaffs.find(s => s.name.includes(cleanName) || cleanName.includes(s.name));
      if (staffByName) {
        setClickedStaffProfile(staffByName);
        setClickedCompanyProfile(null);
        setShowProfileModal(true);
        return;
      }
    }
    
    if (activeChat && activeChat.status !== 'group') {
      const oppCompanyId = activeChat.id.replace('chat_', '').replace(currentUser.id, '').replace('_', '');
      const oppCompany = allCompanies.find(c => c.id === oppCompanyId);
      if (oppCompany) {
        setClickedCompanyProfile(oppCompany);
        setClickedStaffProfile(null);
        setShowProfileModal(true);
      }
    }
  };

  const handleApproveProposal = async (proposalMsgId: string, signatureDataUrl?: string) => {
    if (!activeChat || !currentUser) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const senderName = currentUser.staffName 
      ? `${currentUser.name}_${currentUser.staffName}` 
      : `${currentUser.name}_代表`;

    const updatedMessages = messages.map((m: any) => {
      if (m.id === proposalMsgId) {
        return { ...m, proposalStatus: 'approved', signatureDataUrl };
      }
      return m;
    });

    const systemConfirm = {
      id: 'sys_' + Date.now(),
      type: 'system',
      text: signatureDataUrl 
        ? `${currentUser.name}が電子サイン（手書き署名）を完了し契約に同意しました` 
        : `${currentUser.name}が条件を承認し、Stripe決済（仮押さえ）が完了しました`,
      time: timeStr
    };

    const replyMsg = {
      id: 'msg_' + Date.now(),
      senderId: currentUser.id,
      senderName,
      text: '発注・契約の同意ありがとうございます！署名手続きを行いました。当日はよろしくお願いいたします。',
      time: timeStr
    };

    const finalMessages = [...updatedMessages, systemConfirm, replyMsg];

    try {
      const otherUser = allCompanies.find(c => {
        const sortedIds = [currentUser.id, c.id].sort();
        const generatedId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
        return generatedId === activeChat.id;
      });
      const clientName = currentUser.name;
      const workerName = otherUser ? otherUser.name : '相手';
      const jobTitle = activeChat.title || '商談チャット';

      await api.saveContractTaskChat(activeChat.id, finalMessages, jobTitle, clientName, workerName, relatedJob ? [relatedJob.id] : undefined);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (err) {
      console.error('Failed to approve proposal:', err);
    }
  };

  // 内定オファーのリマインド(バックエンドの自動リマインドが無いため手動送信)。
  // 相手チャットにシステムメッセージを1件追加する。
  const handleSendOfferReminder = async () => {
    if (!activeChat || !currentUser || !chatTasks) return;
    const task = chatTasks.find(t => t.id === activeChat.id);
    if (!task) return;
    const expiry = getOfferExpiryState((task.evaluations as any) || null);
    if (expiry.isExpired) {
      alert('このオファーは有効期限が切れています。');
      return;
    }

    setSendingOfferReminder(true);
    try {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const reminderMsg = {
        id: `sys_offer_reminder_${Date.now()}`,
        type: 'system',
        text: `【内定オファーのリマインド】${relatedJob?.title || activeChat.title} の内定オファーが承諾待ちです。${expiry.hasExpiry ? `${expiry.label} までにご回答ください。` : 'ご確認をお願いいたします。'}`,
        time: timeStr,
      };
      const msgs = (task.evaluations as any)?.messages || getDefaultMessages(activeChat.id);
      await api.saveContractTaskChat(
        activeChat.id,
        [...msgs, reminderMsg],
        activeChat.title || '商談チャット',
        currentUser.name,
        getOpponentCompanyName(activeChat.id, currentUser.id, allCompanies),
        (task.evaluations as any)?.appliedJobIds,
        (task.evaluations as any)?.appliedJobStaffIds,
      );
      setChatTasks(await api.getContractTasks());
      alert('リマインドを送信しました。');
    } catch (e) {
      console.error(e);
      alert('リマインドの送信に失敗しました。');
    } finally {
      setSendingOfferReminder(false);
    }
  };

  const handleAcceptUnofficialOffer = async () => {
    if (!activeChat || !currentUser || !chatTasks) return;
    const task = chatTasks.find(t => t.id === activeChat.id);
    if (!task) return;

    if (getOfferExpiryState((task.evaluations as any) || null).isExpired) {
      alert('このオファーは有効期限が切れているため承諾できません。クライアント企業に再オファーを依頼してください。');
      return;
    }

    try {
      const jobId = getPrimaryLinkedJobId(task.evaluations);
      const job = jobId ? jobs.find(j => j.id === jobId) : undefined;
      if (!jobId || !job) {
        alert('対象の案件が見つかりません。');
        return;
      }

      const staffId = getJobStaffId(task.evaluations, jobId);
      const staff = allStaffs.find(s => s.id === staffId);

      if (requiresSbSubcontractApproval(job)) {
        const approval = getSbSubcontractApproval(task, job.id);
        const approvalCheck = validateSbSubcontractApproval(approval, {
          agencyId: task.agency_id || currentUser.id,
          staffId,
        });
        if (!approvalCheck.valid) {
          alert(`契約を確定できません。${approvalCheck.reason || 'SBの事前書面承諾を確認してください。'}`);
          return;
        }
      }

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const clientComp = allCompanies.find(c => c.id === job.authorId);
      // 1. Create a ContractTask for the actual job assignment (status = 'confirmed')
      const newContractTask = {
        id: `ct_${Date.now()}`,
        jobId: job.id,
        jobTitle: job.title,
        workerName: staff ? staff.name : currentUser.name,
        companyName: currentUser.name,
        clientName: task.clientName,
        price: job.price,
        date: (job.eventDate ? job.eventDate.split(', ')[0] : '') || new Date().toISOString().split('T')[0],
        status: 'confirmed' as const,
        evaluations: {
          messages: [
            { id: `sys_c_${Date.now()}`, type: 'system', text: 'マッチングが成立しました。業務完了後、実績報告と相互評価を行ってください。', time: '現在' }
          ]
        },
        agency_id: currentUser.id,
        client_id: job.authorId,
        clientContractText: clientComp?.contractTemplate || '',
        clientContractPdf: clientComp?.contractPdf || '',
        clientContractApprovedByClient: false,
        clientContractApprovedByAgency: false,
        agencyContractText: currentUser.contractTemplate || '',
        agencyContractPdf: currentUser.contractPdf || '',
        agencyContractApprovedByClient: false,
        agencyContractApprovedByAgency: false
      };

      await api.createContractTask(newContractTask as any);

      // 1.1 Dynamically create or integrate to Company-isolated Group Chat
      const groupChatId = `chat_group_${job.id}_${currentUser.id}`;
      const existingGroupTask = chatTasks.find(t => t.id === groupChatId);
      const staffName = staff ? staff.name : currentUser.name;

      if (existingGroupTask) {
        // If dynamic group chat already exists, append the new staff member
        const existingEvals = existingGroupTask.evaluations || {};
        const assignedStaffIds = [...(existingEvals.assignedStaffIds || [])];
        if (staffId && !assignedStaffIds.includes(staffId)) {
          assignedStaffIds.push(staffId);
        }
        
        const systemAddMsg = {
          id: `sys_add_${Date.now()}`,
          type: 'system',
          text: `(システム) 新しいアサインメンバー ${staffName} がグループに参加しました。`,
          time: timeStr
        };

        const groupMessages = existingEvals.messages || [];
        const updatedGroupMsgs = [...groupMessages, systemAddMsg];

        const newEvals = {
          ...existingEvals,
          assignedStaffIds,
          messages: updatedGroupMsgs
        };

        await api.updateContractTaskStatus(groupChatId, 'confirmed', newEvals);
      } else {
        // Create new company-isolated group chat
        const welcomeMsg = {
          id: `sys_welcome_${Date.now()}`,
          type: 'system',
          text: `現場連絡グループチャットが開設されました。\n【メンバー】: 元請け担当者、下請け担当者、${staffName}`,
          time: timeStr
        };
        const initEvals = {
          assignedStaffIds: staffId ? [staffId] : [],
          messages: [welcomeMsg]
        };

        await api.saveContractTaskChat(
          groupChatId,
          [welcomeMsg],
          job.title,
          task.clientName,
          currentUser.name,
          [job.id],
          (task.evaluations as any)?.appliedJobStaffIds
        );
        await api.updateContractTaskStatus(groupChatId, 'confirmed', initEvals);
      }

      // 2. Append system message (with transition link to group chat) to the admin chat room
      const acceptSystemMsg = {
        id: 'sys_accept_' + Date.now(),
        type: 'system',
        text: `内定が承諾されました`,
        time: timeStr,
        linkToChatId: groupChatId
      };

      const taskMessages = (task.evaluations as any)?.messages || [];
      const updatedMsgs = [...taskMessages, acceptSystemMsg];

      await api.saveContractTaskChat(
        activeChat.id,
        updatedMsgs,
        job.title,
        task.clientName,
        currentUser.name,
        [job.id],
        (task.evaluations as any)?.appliedJobStaffIds
      );

      // 案件ごとに状態を持たせる(同じチャットの別案件に影響させない)。
      // 契約書テンプレートがあれば「契約書承認待ち」サブバッジの起点フラグを立てる。
      await api.updateContractTaskJobStatus(activeChat.id, job.id, 'confirmed', {
        contractApprovalRequired: !!(clientComp?.contractTemplate || currentUser.contractTemplate),
      });

      // 3. Automatically reject and notify other candidates for this job
      const otherChatTasks = chatTasks.filter(t => {
        if (t.id === activeChat.id || !isDirectChatTask(t)) return false;
        const isForThisJob = isJobLinkedToChat(t.evaluations, job.id);
        return isForThisJob && (t.status === 'applying' || t.status === 'offered');
      });

      for (const t of otherChatTasks) {
        const rejectSystemMsg = {
          id: 'sys_reject_auto_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
          type: 'system',
          text: `【選考結果のお知らせ】\nご提案いただき誠にありがとうございました。\n厳正なる選考の結果、大変恐縮ながら今回は採用を見送らせていただくこととなりました。\nまたの機会がございましたら何卒よろしくお願い申し上げます。`,
          time: timeStr
        };
        const taskMessages = (t.evaluations as any)?.messages || [];
        const updatedMsgsForOther = [...taskMessages, rejectSystemMsg];
        await api.saveContractTaskChat(
          t.id,
          updatedMsgsForOther,
          t.jobTitle,
          t.clientName,
          t.workerName,
          (t.evaluations as any)?.appliedJobIds,
          (t.evaluations as any)?.appliedJobStaffIds
        );
        // この案件(job.id)への応募だけを見送りにする。
        // 同じ直接チャットで進行中の別案件は影響を受けない(旧実装のバグ)。
        await api.updateContractTaskJobStatus(t.id, job.id, 'rejected');
      }

      alert('🎉 内定を承諾しました。契約が確定しました！');
      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (err) {
      console.error('Failed to accept unofficial offer:', err);
      alert('承諾処理中にエラーが発生しました。');
    }
  };

  const handleDeclineUnofficialOffer = async (skipConfirm: boolean = false) => {
    if (!activeChat || !currentUser || !chatTasks) return;
    const task = chatTasks.find(t => t.id === activeChat.id);
    if (!task) return;

    if (!skipConfirm && !confirm('本当にこの内定を辞退しますか？')) return;

    try {
      const jobId = getPrimaryLinkedJobId(task.evaluations);
      const job = jobs.find(j => j.id === jobId);

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const declineSystemMsg = {
        id: 'sys_decline_' + Date.now(),
        type: 'system',
        text: `❌ 下請け企業により内定が辞退されました。`,
        time: timeStr
      };

      const replyMsg = {
        id: 'msg_decline_reply_' + Date.now(),
        senderId: currentUser.id,
        senderName: currentUser.staffName ? `${currentUser.name}_${currentUser.staffName}` : `${currentUser.name}_代表`,
        text: '申し訳ございませんが、今回は日程や体制の都合上辞退させていただきます。',
        time: timeStr
      };

      const taskMessages = (task.evaluations as any)?.messages || [];
      const updatedMsgs = [...taskMessages, declineSystemMsg, replyMsg];

      await api.saveContractTaskChat(
        activeChat.id,
        updatedMsgs,
        job ? job.title : activeChat.title,
        task.clientName,
        currentUser.name,
        job ? [job.id] : undefined,
        (task.evaluations as any)?.appliedJobStaffIds
      );

      if (jobId) {
        await api.updateContractTaskJobStatus(activeChat.id, jobId, 'declined');
      } else {
        await api.updateContractTaskStatus(activeChat.id, 'declined');
      }

      alert('内定を辞退しました。');
      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (err) {
      console.error('Failed to decline unofficial offer:', err);
      alert('辞退処理中にエラーが発生しました。');
    }
  };



  // 該当の案件に対してすでに何らかの応募（applying, offered, confirmed, rejected, declined）が存在するかどうか
  const hasApplications = useMemo(() => {
    if (!relatedJob) return false;
    return chatTasks.some(t => {
      const hasJob = isJobLinkedToChat(t.evaluations, relatedJob.id);
      const isAppliedStatus = t.status === 'applying' || t.status === 'offered' || t.status === 'confirmed' || t.status === 'rejected' || t.status === 'declined';
      return hasJob && isAppliedStatus;
    });
  }, [relatedJob, chatTasks]);

  // 1対1チャットにおける対向の「会社名 氏名（代表）」を解決する
  const headerTitle = useMemo(() => {
    if (!activeChat || !currentUser) return '';
    if (activeChat.status === 'group') return activeChat.name;

    const parts = activeChat.id.split('_');
    if (parts.length < 3) return activeChat.name;

    const opponentId = parts[1] === currentUser.id ? parts[2] : parts[1];
    const opponent = allCompanies.find(c => c.id === opponentId);
    if (!opponent) return activeChat.name;

    // 相手企業の「実際にこのチャットに関与している担当者」を優先表示。
    // (会社の代表者とは限らない — 応募したスタッフや、実際に発言している担当者)
    const task = chatTasks.find(t => t.id === activeChat.id);
    const jobId = relatedJob?.id || getPrimaryLinkedJobId(task?.evaluations) || '';
    const appliedStaffId = task ? getJobStaffId(task.evaluations, jobId) : undefined;
    const appliedStaff = allStaffs.find(s => s.id === appliedStaffId);
    let personName = appliedStaff && appliedStaff.userId === opponentId ? appliedStaff.name : '';
    if (!personName) {
      // 相手企業からの発言者(会社名_個人名)を探す
      for (const m of messages as any[]) {
        const sn = m.senderName ? String(m.senderName) : '';
        const i = sn.indexOf('_');
        if (i > 0 && sn.slice(0, i) === opponent.name) {
          const p = sn.slice(i + 1).trim();
          if (p && p !== '代表' && p !== '担当者') { personName = p; break; }
        }
      }
    }
    if (!personName) personName = opponent.representativeName || '';
    return `${opponent.name} ${personName}`.trim();
  }, [activeChat, currentUser, allCompanies, allStaffs, chatTasks, relatedJob, messages]);

  const headerHeight = useMemo(() => {
    let height = 72;
    if (activeChat?.status === 'group') {
      height = 140;
    } else if (activeChat?.status === 'offered' && !isClient) {
      height = 160;
    }
    if (relatedTask && relatedTask.jobId && relatedTask.jobId !== 'chat' && !contractApproved) {
      height += 48;
    }
    return `calc(${height}px + env(safe-area-inset-top))`;
  }, [activeChat, isClient, relatedTask, contractApproved]);


  const transportArranged = useMemo(() => {
    if (!relatedJob) return true;
    return relatedJob.expenses?.transportType === 'arranged';
  }, [relatedJob]);

  const accommodationArranged = useMemo(() => {
    if (!relatedJob) return true;
    return relatedJob.expenses?.accommodationType === 'arranged';
  }, [relatedJob]);

  // 領収書の提出処理
  const handleSendReceipt = async () => {
    if (!activeChat || !currentUser || !receiptAmount || !receiptItem.trim()) return;
    
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderName = currentUser.staffName 
      ? `${currentUser.name}_${currentUser.staffName}` 
      : `${currentUser.name}_代表`;

    const categoryText = getExpenseCategoryLabel(receiptCategory);

    let detailsText = '';
    let detailsObj: any = {
      category: receiptCategory,
      amount: receiptAmount,
      item: receiptItem.trim(),
      notes: receiptNotes.trim(),
      status: 'pending'
    };

    if (receiptCategory === 'transport') {
      detailsObj.route = receiptRoute.trim();
      detailsText = `(品目: ${receiptItem.trim()}${receiptRoute ? `, 区間: ${receiptRoute.trim()}` : ''})`;
    } else if (receiptCategory === 'accommodation') {
      detailsObj.hotelName = receiptHotelName.trim();
      detailsObj.nights = receiptNights.trim();
      detailsText = `(品目: ${receiptItem.trim()}${receiptHotelName ? `, 宿泊先: ${receiptHotelName.trim()}` : ''}${receiptNights ? `, 日数: ${receiptNights.trim()}` : ''})`;
    } else if (receiptCategory === 'car') {
      const distance = Number(receiptDistance) || 0;
      const rate = Number(receiptGasolineRate) || 0;
      const gas = Math.round(distance * rate);
      const expressway = Number(receiptExpressway) || 0;
      const parking = Number(receiptParking) || 0;
      
      detailsObj.distance = distance;
      detailsObj.gasolineRate = rate;
      detailsObj.gasoline = gas;
      detailsObj.expressway = expressway;
      detailsObj.parking = parking;
      detailsObj.route = receiptRoute.trim();

      detailsText = `(品目: ${receiptItem.trim()}, 距離: ${distance}km, ガソリン代: ¥${gas.toLocaleString()}${expressway ? `, 高速代: ¥${expressway.toLocaleString()}` : ''}${parking ? `, 駐車場代: ¥${parking.toLocaleString()}` : ''})`;
    }

    const receiptMsg = {
      id: 'rc_' + Date.now(),
      type: 'sent',
      senderId: currentUser.id,
      senderName,
      text: `【経費申請】${categoryText}: ¥${receiptAmount.toLocaleString()} の精算申請 ${detailsText}`,
      time: timeStr,
      isReceipt: true,
      receiptDetails: detailsObj
    };

    const memberName = currentUser.staffName || '代表';
    const systemLogMsg = {
      id: 'sys_rc_' + Date.now(),
      type: 'system',
      text: `${currentUser.name} ${memberName}が${categoryText}の経費申請を行いました`,
      time: timeStr
    };

    try {
      const task = chatTasks.find(t => t.id === activeChat.id);
      const msgs = task?.evaluations?.messages || getDefaultMessages(activeChat.id);
      const updated = [...msgs, receiptMsg, systemLogMsg];
      
      const jobTitle = activeChat.title || '商談チャット';
      const clientName = getOpponentCompanyName(activeChat.id, currentUser.id, allCompanies, 'クライアント企業');
      const workerName = currentUser.name;

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
      setShowReceiptModal(false);

      // Reset states
      setReceiptAmount(0);
      setReceiptItem('');
      setReceiptRoute('');
      setReceiptNotes('');
      setReceiptHotelName('');
      setReceiptNights('');
      setReceiptDistance('');
      setReceiptGasolineRate(15);
      setReceiptExpressway('');
      setReceiptParking('');
    } catch (e) {
      console.error(e);
      alert('領収書の提出に失敗しました');
    }
  };

  // 手配情報の共有処理
  const handleSendArrangement = async () => {
    if (!activeChat || !currentUser || !arrangementInfo.trim()) return;
    
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderName = currentUser.staffName 
      ? `${currentUser.name}_${currentUser.staffName}` 
      : `${currentUser.name}_代表`;

    const arrangementMsg = {
      id: 'ar_' + Date.now(),
      type: 'sent',
      senderId: currentUser.id,
      senderName,
      text: `【手配情報共有】${arrangementCategory === 'transport' ? '交通手配' : '宿泊手配'}の情報共有`,
      time: timeStr,
      isArrangement: true,
      arrangementDetails: {
        category: arrangementCategory,
        info: arrangementInfo
      }
    };

    const systemLogMsg = {
      id: 'sys_ar_' + Date.now(),
      type: 'system',
      text: `${currentUser.name}が${arrangementCategory === 'transport' ? '交通手配' : '宿泊手配'}の情報を共有しました。`,
      time: timeStr
    };

    try {
      const task = chatTasks.find(t => t.id === activeChat.id);
      const msgs = task?.evaluations?.messages || getDefaultMessages(activeChat.id);
      const updated = [...msgs, arrangementMsg, systemLogMsg];
      
      const jobTitle = activeChat.title || '商談チャット';
      const clientName = currentUser.name;
      const workerName = getOpponentCompanyName(activeChat.id, currentUser.id, allCompanies);

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
      setShowArrangementModal(false);
    } catch (e) {
      console.error(e);
      alert('手配情報の共有に失敗しました');
    }
  };



  // 写真の送信処理
  const handleSendPhoto = async () => {
    if (!activeChat || !currentUser || !selectedPhotoUrl) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const senderName = currentUser.staffName 
      ? `${currentUser.name}_${currentUser.staffName}` 
      : `${currentUser.name}_代表`;

    const photoMsg = {
      id: 'photo_' + Date.now(),
      type: 'sent',
      senderId: currentUser.id,
      senderName,
      text: `【写真添付】${photoCaption || '現場写真'}`,
      time: timeStr,
      isPhoto: true,
      photoDetails: {
        url: selectedPhotoUrl,
        caption: photoCaption || '現場写真'
      }
    };

    const systemLogMsg = {
      id: 'sys_photo_' + Date.now(),
      type: 'system',
      text: `${currentUser.name}が現場写真を送信しました。`,
      time: timeStr
    };

    try {
      const task = chatTasks.find(t => t.id === activeChat.id);
      const msgs = task?.evaluations?.messages || getDefaultMessages(activeChat.id);
      const updated = [...msgs, photoMsg, systemLogMsg];

      const jobTitle = activeChat.title || '商談チャット';
      const clientName = getOpponentCompanyName(activeChat.id, currentUser.id, allCompanies, 'クライアント企業');
      const workerName = currentUser.name;

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
      setShowPhotoModal(false);
      setPhotoCaption('');
      setSelectedPhotoUrl('');
      setSelectedPhotoName('');
    } catch (err) {
      console.error('Failed to send photo:', err);
      alert('写真の送信に失敗しました');
    }
  };

  // 精算承認処理
  const handleApproveReceipt = async (msgId: string) => {
    if (!activeChat || !currentUser) return;
    
    try {
      const task = chatTasks.find(t => t.id === activeChat.id);
      const msgs = [...(task?.evaluations?.messages || [])];
      
      const targetIdx = msgs.findIndex(m => m.id === msgId);
      if (targetIdx === -1) return;
      
      const targetMsg = { ...msgs[targetIdx] };
      if (!targetMsg.receiptDetails) return;
      
      targetMsg.receiptDetails = {
        ...targetMsg.receiptDetails,
        status: 'approved'
      };
      
      // テキスト表記の変更
      const approvedCategoryText = getExpenseCategoryLabel(targetMsg.receiptDetails.category);
      targetMsg.text = `【領収書承認済】${approvedCategoryText}: ¥${targetMsg.receiptDetails.amount?.toLocaleString()} の精算完了`;
      msgs[targetIdx] = targetMsg;
      
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const systemLogMsg = {
        id: 'sys_app_rc_' + Date.now(),
        type: 'system',
        text: `クライアントによって${approvedCategoryText}の精算（¥${targetMsg.receiptDetails.amount?.toLocaleString()}）が承認されました。`,
        time: timeStr
      };
      
      const updated = [...msgs, systemLogMsg];
      
      const jobTitle = activeChat.title || '商談チャット';
      const clientName = currentUser.name;
      const workerName = getOpponentCompanyName(activeChat.id, currentUser.id, allCompanies);

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (e) {
      console.error(e);
      alert('精算の承認に失敗しました');
    }
  };

  const handleRejectReceipt = async (msgId: string) => {
    if (!activeChat || !currentUser) return;
    const reason = prompt('差戻し理由を入力してください（任意）:', '内容・金額に不備があるため再確認をお願いします。');
    if (reason === null) return;
    
    try {
      const task = chatTasks.find(t => t.id === activeChat.id);
      const msgs = [...(task?.evaluations?.messages || [])];
      
      const targetIdx = msgs.findIndex(m => m.id === msgId);
      if (targetIdx === -1) return;
      
      const targetMsg = { ...msgs[targetIdx] };
      if (!targetMsg.receiptDetails) return;
      
      targetMsg.receiptDetails = {
        ...targetMsg.receiptDetails,
        status: 'rejected',
        rejectionReason: reason
      };
      msgs[targetIdx] = targetMsg;
      
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const systemLogMsg = {
        id: 'sys_rej_rc_' + Date.now(),
        type: 'system',
        text: `【経費申請差戻し】申請（¥${targetMsg.receiptDetails.amount?.toLocaleString()}）が差戻されました。理由: ${reason}`,
        time: timeStr
      };
      
      const updated = [...msgs, systemLogMsg];
      
      const jobTitle = activeChat.title || '商談チャット';
      const clientName = currentUser.name;
      const workerName = getOpponentCompanyName(activeChat.id, currentUser.id, allCompanies);

      await api.saveContractTaskChat(activeChat.id, updated, jobTitle, clientName, workerName);

      const updatedTasks = await api.getContractTasks();
      setChatTasks(updatedTasks);
    } catch (e) {
      console.error(e);
      alert('精算の差戻し処理に失敗しました');
    }
  };

  const handleOpenSignatureModal = (msgId: string) => {
    setPendingProposalMsgId(msgId);
    setShowSignatureModal(true);
  };

  const handleConfirmSignatureAndApprove = async () => {
    if (!pendingProposalMsgId || !activeChat || !currentUser) return;
    
    let signatureDataUrl = '';
    if (signatureCanvasRef.current) {
      signatureDataUrl = signatureCanvasRef.current.toDataURL('image/png');
    }

    try {
      await handleApproveProposal(pendingProposalMsgId, signatureDataUrl);
      setShowSignatureModal(false);
      setPendingProposalMsgId(null);
      alert('電子サインを取り行い、契約同意が完了いたしました！');
    } catch (e) {
      console.error(e);
      alert('署名承認に失敗しました');
    }
  };

  // 条件編集モーダルを開く
  const handleOpenEditConditions = () => {
    if (!relatedJob) return;
    setEditConditionsPrice(relatedJob.price);
    setEditConditionsDate(relatedJob.eventDate || '');
    setShowEditConditionsModal(true);
    setShowChatMenu(false);
  };

  // 条件変更を保存する
  const handleSaveConditions = async () => {
    if (!relatedJob || !activeChat || !currentUser) return;

    try {
      // 1. Supabaseの案件情報を更新
      await api.updateJob(relatedJob.id, {
        price: editConditionsPrice,
        eventDate: editConditionsDate
      });

      // 2. システムログメッセージをチャットに追加
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const systemLogMsg = {
        id: 'sys_cond_' + Date.now(),
        type: 'system',
        text: `📢 クライアント企業が案件条件を変更しました。\n【変更後単価】: ¥${editConditionsPrice.toLocaleString()} / 日\n【変更後稼働日】: ${editConditionsDate || '未定'}`,
        time: timeStr
      };

      const task = chatTasks.find(t => t.id === activeChat.id);
      const msgs = task?.evaluations?.messages || getDefaultMessages(activeChat.id);
      const updated = [...msgs, systemLogMsg];

      // Resolve other user's company name correctly
      const otherUser = allCompanies.find(c => {
        const sortedIds = [currentUser.id, c.id].sort();
        const generatedId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
        return generatedId === activeChat.id;
      });
      const clientName = currentUser.name;
      const workerName = otherUser ? otherUser.name : '相手';

      await api.saveContractTaskChat(
        activeChat.id, 
        updated, 
        relatedJob.title, 
        clientName, 
        workerName, 
        (task?.evaluations as any)?.appliedJobIds, 
        (task?.evaluations as any)?.appliedJobStaffIds
      );

      // 3. 画面の再同期とクローズ
      await handleSync();
      setShowEditConditionsModal(false);
      alert('案件の契約条件を更新し、チャットに反映しました。');
    } catch (e) {
      console.error(e);
      alert('契約条件の更新に失敗しました。');
    }
  };

  const renderReceiptCard = (msg: any) => {
    const isApproved = msg.receiptDetails?.status === 'approved';
    const category = msg.receiptDetails?.category || 'transport';
    const categoryLabel = getExpenseCategoryLabel(category);
    const amount = msg.receiptDetails?.amount || 0;
    const item = msg.receiptDetails?.item || '';
    const route = msg.receiptDetails?.route || '';
    const notes = msg.receiptDetails?.notes || '';
    const hotelName = msg.receiptDetails?.hotelName || '';
    const nights = msg.receiptDetails?.nights || '';
    const distance = msg.receiptDetails?.distance;
    const gasolineRate = msg.receiptDetails?.gasolineRate;
    const gasoline = msg.receiptDetails?.gasoline;
    const expressway = msg.receiptDetails?.expressway;
    const parking = msg.receiptDetails?.parking;
    
    return (
      <div className="receipt-card" style={{ 
        background: 'var(--surface-color)', 
        border: isApproved ? '2px solid #10B981' : '2px dashed #F59E0B', 
        borderRadius: '12px', 
        padding: '14px', 
        width: '100%',
        maxWidth: '240px',
        boxSizing: 'border-box',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        color: '#1F2937',
        textAlign: 'left'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: isApproved ? '#047857' : '#B45309' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>receipt_long</span>
            <span style={{ fontSize: '13px' }}>経費申請 ({categoryLabel})</span>
          </div>
          <span style={{ 
            fontSize: '10px', 
            fontWeight: 'bold', 
            padding: '2px 8px', 
            borderRadius: '12px',
            background: isApproved ? '#DEF7EC' : '#FEF3C7',
            color: isApproved ? '#03543F' : '#D97706',
            whiteSpace: 'nowrap'
          }}>
            {isApproved ? '精算完了' : '承認待ち'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', background: '#F9FAFB', padding: '10px', borderRadius: '8px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
            <span style={{ color: '#6B7280' }}>申請金額:</span>
            <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#111827' }}>¥{amount.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
            <span style={{ color: '#6B7280' }}>品目:</span>
            <span style={{ fontWeight: 'bold', color: '#374151' }}>{item || '未指定'}</span>
          </div>
          {category === 'accommodation' && hotelName && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280', fontSize: '10px' }}>宿泊先:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>{hotelName}</span>
            </div>
          )}
          {category === 'accommodation' && nights && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280' }}>宿泊日数:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>{nights} 泊</span>
            </div>
          )}
          {category === 'car' && distance !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280' }}>移動距離:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>{distance} km</span>
            </div>
          )}
          {category === 'car' && gasolineRate !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280' }}>ガソリン単価:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>{gasolineRate} 円/km</span>
            </div>
          )}
          {category === 'car' && gasoline !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280' }}>ガソリン代:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>¥{gasoline.toLocaleString()}</span>
            </div>
          )}
          {category === 'car' && expressway !== undefined && expressway > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280' }}>高速代:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>¥{expressway.toLocaleString()}</span>
            </div>
          )}
          {category === 'car' && parking !== undefined && parking > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280' }}>駐車場代:</span>
              <span style={{ color: '#374151', fontWeight: 'bold' }}>¥{parking.toLocaleString()}</span>
            </div>
          )}
          {route && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: '1px solid #E5E7EB', paddingBottom: '4px' }}>
              <span style={{ color: '#6B7280', fontSize: '10px' }}>{category === 'car' ? '移動ルート' : '利用区間'}:</span>
              <span style={{ color: '#374151' }}>{route}</span>
            </div>
          )}
          {notes && (
            <div style={{ marginTop: '2px' }}>
              <div style={{ color: '#6B7280', fontSize: '10px', marginBottom: '2px' }}>備考:</div>
              <div style={{ color: '#374151', wordBreak: 'break-all', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{notes}</div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10B981', fontSize: '11px', marginTop: '4px', borderTop: '1px dashed #E5E7EB', paddingTop: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>image</span>
            <span>領収書画像 (添付あり)</span>
          </div>
        </div>
        
        {msg.receiptDetails?.status === 'rejected' ? (
          <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '6px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center' }}>
            ✕ 差戻し中（{msg.receiptDetails?.rejectionReason || '内容修正が必要'}）
          </div>
        ) : !isApproved && isClient ? (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button 
              onClick={() => handleApproveReceipt(msg.id)}
              style={{ 
                flex: 1,
                background: '#10B981', 
                color: '#FFFFFF', 
                border: 'none', 
                fontSize: '11px', 
                padding: '8px', 
                borderRadius: '6px', 
                cursor: 'pointer', 
                fontWeight: 'bold', 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
              承認
            </button>
            <button 
              onClick={() => handleRejectReceipt(msg.id)}
              style={{ 
                flex: 1,
                background: '#EF4444', 
                color: '#FFFFFF', 
                border: 'none', 
                fontSize: '11px', 
                padding: '8px', 
                borderRadius: '6px', 
                cursor: 'pointer', 
                fontWeight: 'bold', 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>cancel</span>
              差戻し
            </button>
          </div>
        ) : !isApproved ? (
          <div style={{ textAlign: 'center', fontSize: '10px', color: '#9CA3AF', padding: '4px 0' }}>
            ※承認されると精算が確定します
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '11px', color: '#10B981', fontWeight: 'bold', padding: '4px 0' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>task_alt</span>
            精算が完了しています
          </div>
        )}

        {/* (Template Modal) 定型文テンプレート選択・作成モーダル */}
        {showTemplateModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}>
            <div style={{
              background: 'var(--surface-color)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '440px',
              padding: '20px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)' }}>
                  <span className="material-symbols-outlined" style={{ color: '#4F46E5' }}>description</span>
                  定型文テンプレートを選択
                </h3>
                <button 
                  onClick={() => setShowTemplateModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)' }}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px', marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-sub)', marginBottom: '4px' }}>標準定型文</div>
                {defaultChatTemplates.map((tmpl, idx) => (
                  <div
                    key={'def_' + idx}
                    onClick={() => {
                      setInputText(prev => prev ? `${prev}\n${tmpl}` : tmpl);
                      setShowTemplateModal(false);
                    }}
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    {tmpl}
                  </div>
                ))}

                {customTemplates.length > 0 && (
                  <>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-sub)', marginTop: '8px', marginBottom: '4px' }}>マイ保存テンプレート</div>
                    {customTemplates.map((tmpl, idx) => (
                      <div
                        key={'cust_' + idx}
                        onClick={() => {
                          setInputText(prev => prev ? `${prev}\n${tmpl}` : tmpl);
                          setShowTemplateModal(false);
                        }}
                        style={{
                          background: '#EEF2FF',
                          border: '1px solid #C7D2FE',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          fontSize: '12px',
                          lineHeight: '1.5',
                          cursor: 'pointer',
                          position: 'relative'
                        }}
                      >
                        {tmpl}
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* 新規定型文の追加 */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', gap: '8px' }}>
                <input 
                  type="text"
                  placeholder="新しい定型文を保存..."
                  value={newTemplateInput}
                  onChange={e => setNewTemplateInput(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px' }}
                />
                <button
                  onClick={() => {
                    if (!newTemplateInput.trim()) return;
                    const updated = [...customTemplates, newTemplateInput.trim()];
                    setCustomTemplates(updated);
                    localStorage.setItem('connexy_chat_templates', JSON.stringify(updated));
                    setNewTemplateInput('');
                  }}
                  disabled={!newTemplateInput.trim()}
                  style={{
                    background: newTemplateInput.trim() ? '#4F46E5' : '#CBD5E1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: newTemplateInput.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* (Signature Modal) 手書き電子サインコンポーネントモーダル */}
        {showSignatureModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 1350,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}>
            <div style={{
              background: 'var(--surface-color)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '400px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)' }}>
                  <span className="material-symbols-outlined" style={{ color: '#10B981' }}>draw</span>
                  手書き電子サイン・契約同意
                </h3>
                <button 
                  onClick={() => setShowSignatureModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)' }}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-sub)', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                下記の枠内にマウスまたはタッチ操作で署名（サイン）をご記入の上、同意ボタンを押してください。
              </p>

              {/* Canvas 描画枠 */}
              <div style={{ border: '2px dashed #94A3B8', borderRadius: '8px', background: '#FFFFFF', position: 'relative', marginBottom: '12px' }}>
                <canvas 
                  ref={signatureCanvasRef}
                  width={340}
                  height={140}
                  onMouseDown={(e) => {
                    const ctx = signatureCanvasRef.current?.getContext('2d');
                    if (!ctx || !signatureCanvasRef.current) return;
                    setIsDrawingSignature(true);
                    const rect = signatureCanvasRef.current.getBoundingClientRect();
                    const scaleX = signatureCanvasRef.current.width / rect.width;
                    const scaleY = signatureCanvasRef.current.height / rect.height;
                    ctx.beginPath();
                    ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                  }}
                  onMouseMove={(e) => {
                    if (!isDrawingSignature || !signatureCanvasRef.current) return;
                    const ctx = signatureCanvasRef.current.getContext('2d');
                    if (!ctx) return;
                    const rect = signatureCanvasRef.current.getBoundingClientRect();
                    const scaleX = signatureCanvasRef.current.width / rect.width;
                    const scaleY = signatureCanvasRef.current.height / rect.height;
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = 'round';
                    ctx.strokeStyle = '#0F172A';
                    ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                    ctx.stroke();
                  }}
                  onMouseUp={() => setIsDrawingSignature(false)}
                  onTouchStart={(e) => {
                    const ctx = signatureCanvasRef.current?.getContext('2d');
                    if (!ctx || !e.touches[0] || !signatureCanvasRef.current) return;
                    setIsDrawingSignature(true);
                    const rect = signatureCanvasRef.current.getBoundingClientRect();
                    const scaleX = signatureCanvasRef.current.width / rect.width;
                    const scaleY = signatureCanvasRef.current.height / rect.height;
                    ctx.beginPath();
                    ctx.moveTo((e.touches[0].clientX - rect.left) * scaleX, (e.touches[0].clientY - rect.top) * scaleY);
                  }}
                  onTouchMove={(e) => {
                    if (!isDrawingSignature || !e.touches[0] || !signatureCanvasRef.current) return;
                    const ctx = signatureCanvasRef.current.getContext('2d');
                    if (!ctx) return;
                    const rect = signatureCanvasRef.current.getBoundingClientRect();
                    const scaleX = signatureCanvasRef.current.width / rect.width;
                    const scaleY = signatureCanvasRef.current.height / rect.height;
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = 'round';
                    ctx.strokeStyle = '#0F172A';
                    ctx.lineTo((e.touches[0].clientX - rect.left) * scaleX, (e.touches[0].clientY - rect.top) * scaleY);
                    ctx.stroke();
                  }}
                  onTouchEnd={() => setIsDrawingSignature(false)}
                  style={{ width: '100%', height: '140px', display: 'block', cursor: 'crosshair', touchAction: 'none' }}
                />
                <button
                  onClick={() => {
                    const ctx = signatureCanvasRef.current?.getContext('2d');
                    if (ctx && signatureCanvasRef.current) {
                      ctx.clearRect(0, 0, signatureCanvasRef.current.width, signatureCanvasRef.current.height);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    background: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  クリア
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setShowSignatureModal(false)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  キャンセル
                </button>
                <button 
                  onClick={handleConfirmSignatureAndApprove}
                  style={{
                    flex: 2,
                    padding: '10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#10B981',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>verified</span>
                  電子署名して契約同意
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderArrangementCard = (msg: any) => {
    const categoryLabel = msg.arrangementDetails?.category === 'transport' ? '交通手配' : '宿泊手配';
    const info = msg.arrangementDetails?.info || '';
    const isTransport = msg.arrangementDetails?.category === 'transport';
    
    return (
      <div className="arrangement-card" style={{ 
        background: 'var(--surface-color)', 
        border: '2px solid #3B82F6', 
        borderRadius: '12px', 
        padding: '14px', 
        width: '100%',
        maxWidth: '240px',
        boxSizing: 'border-box',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        color: '#1F2937',
        textAlign: 'left'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: '#1D4ED8', marginBottom: '10px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
            {isTransport ? 'directions_transit' : 'hotel'}
          </span>
          <span style={{ fontSize: '13px' }}>手配情報共有 ({categoryLabel})</span>
        </div>
        <div style={{ 
          fontSize: '12px', 
          color: '#1F2937', 
          background: '#EFF6FF', 
          padding: '10px', 
          borderRadius: '8px',
          border: '1px solid #BFDBFE'
        }}>
          <div style={{ fontWeight: 'bold', color: '#1E40AF', marginBottom: '6px', fontSize: '11px' }}>手配内容・予約情報:</div>
          <div style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap', lineHeight: '1.5', color: '#1E3A8A' }}>
            {info}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#3B82F6', fontSize: '11px', marginTop: '10px', justifyContent: 'center', fontWeight: 'bold' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>verified</span>
          <span>手配完了</span>
        </div>
      </div>
    );
  };

  const renderPhotoCard = (msg: any) => {
    const url = msg.photoDetails?.url;
    const caption = msg.photoDetails?.caption || '現場写真';
    
    return (
      <div className="photo-card" style={{ 
        background: 'var(--surface-color)', 
        border: '1px solid #E2E8F0', 
        borderRadius: '12px', 
        overflow: 'hidden',
        width: '100%',
        maxWidth: '220px',
        boxSizing: 'border-box',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        color: '#1F2937',
        textAlign: 'left'
      }}>
        <img 
          src={url} 
          alt={caption} 
          style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }} 
        />
        <div style={{ padding: '8px 12px', fontSize: '12px', background: '#F8FAFC' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)', fontWeight: 'bold' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#8B5CF6' }}>photo_camera</span>
            <span style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{caption}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderLocationCard = (msg: any) => {
    const url = msg.locationDetails?.url || `https://www.google.com/maps?q=${msg.locationDetails?.latitude},${msg.locationDetails?.longitude}`;
    
    return (
      <div className="location-card" style={{ 
        background: 'var(--surface-color)', 
        border: '2px solid #F59E0B', 
        borderRadius: '12px', 
        padding: '12px', 
        width: '100%',
        maxWidth: '220px',
        boxSizing: 'border-box',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        color: '#1F2937',
        textAlign: 'left'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: '#D97706', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>share_location</span>
          <span style={{ fontSize: '12px' }}>現在地共有（GPS）</span>
        </div>
        <div style={{ 
          fontSize: '11px', 
          color: '#1F2937', 
          background: '#FFFBEB', 
          padding: '8px', 
          borderRadius: '6px',
          border: '1px solid #FDE68A',
          marginBottom: '8px'
        }}>
          <div style={{ color: '#B45309', fontWeight: 'bold', marginBottom: '2px', fontSize: '10px' }}>位置情報:</div>
          <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#78350F' }}>
            {msg.locationDetails?.latitude?.toFixed(6)}, {msg.locationDetails?.longitude?.toFixed(6)}
          </div>
        </div>
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ 
            background: '#F59E0B', 
            color: '#FFFFFF', 
            textDecoration: 'none',
            fontSize: '11px', 
            padding: '6px 10px', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontWeight: 'bold', 
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            boxShadow: '0 2px 4px rgba(245, 158, 11, 0.2)'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>map</span>
          Googleマップで開く
        </a>
      </div>
    );
  };

  return (
    <div className="view active" style={{ display: 'flex' }}>
      <header className="solid-header" style={{ height: 'auto', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>メッセージ</h1>
          <button className="icon-btn-dark" onClick={() => window.dispatchEvent(new Event('open-settings-menu'))} title="メニュー" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>
        <div className="header-search chat-search" style={{ marginTop: '8px' }}>
          <div className="search-bar">
            <span className="material-symbols-outlined icon">search</span>
            <input 
              type="text" 
              placeholder="メッセージ・案件名で検索" 
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
            />
          </div>
        </div>
        
        {/* チャット種別フィルターカプセル */}
        {currentUser && currentUser.staffRole !== 'staff' && (
          <div style={{
            display: 'flex',
            background: '#F1F5F9',
            padding: '2px',
            borderRadius: '20px',
            marginTop: '10px',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
            width: '100%'
          }}>
            {[
              { id: 'all', label: 'すべて' },
              { id: 'admin', label: '管理者間' },
              { id: 'staff', label: 'スタッフ含む' }
            ].map(opt => {
              const isSel = chatTypeFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setChatTypeFilter(opt.id as any)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: '18px',
                    border: 'none',
                    background: isSel ? '#FFFFFF' : 'transparent',
                    color: isSel ? 'var(--primary)' : '#64748B',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    boxShadow: isSel ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </header>
      <main className="list-area" style={{ overflowY: 'auto' }}>
        <div className="chat-list">
          {Object.keys(groupedChannels).length > 0 ? (
            Object.keys(groupedChannels).map((groupName) => {
              const groupChannels = groupedChannels[groupName];
              const isExpanded = expandedCompanies[groupName] !== false;
              
              return (
                <div key={groupName} style={{ marginBottom: '8px' }}>
                  {/* アコーディオンヘッダー */}
                  <div 
                    onClick={() => setExpandedCompanies(prev => ({ ...prev, [groupName]: !isExpanded }))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 16px',
                      background: '#F8FAFC',
                      borderBottom: '1px solid #E2E8F0',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: 'var(--text-main)',
                      transition: 'background 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#64748B' }}>
                        {groupName === '現場グループチャット' ? 'groups' : 'corporate_fare'}
                      </span>
                      <span>{groupName} ({groupChannels.length})</span>
                    </div>
                    <span 
                      className="material-symbols-outlined" 
                      style={{ 
                        fontSize: '18px', 
                        color: '#64748B', 
                        transform: isExpanded ? 'rotate(180deg)' : 'none', 
                        transition: 'transform 0.2s' 
                      }}
                    >
                      expand_more
                    </span>
                  </div>

                  {/* アコーディオンコンテンツ */}
                  {isExpanded && (
                    <div style={{ borderBottom: '1px solid #E2E8F0' }}>
                      {groupChannels.map((channel) => {
                        const isSelected = activeChatId === channel.id;
                        
                        return (
                          <div 
                            key={channel.id} 
                            className={`chat-item ${isSelected ? 'active' : ''}`} 
                            onClick={() => {
                              setActiveChatId(channel.id);
                              window.history.pushState({ activeChatId: channel.id }, '');
                            }}
                            style={{ paddingLeft: '24px', background: isSelected ? '#F0F9FF' : 'white' }}
                          >
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <div className={`chat-avatar ${channel.avatarBg}`}>{channel.avatar}</div>
                              {channel.isUnread && (
                                <span className="unread-dot" style={{
                                  position: 'absolute',
                                  top: '-2px',
                                  right: '-2px',
                                  width: '10px',
                                  height: '10px',
                                  backgroundColor: '#EF4444',
                                  borderRadius: '50%',
                                  border: '2px solid white',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                }} />
                              )}
                            </div>
                            <div className="chat-content">
                              <div className="chat-header">
                                <span className="company-name" style={{ fontSize: '13px', fontWeight: 'bold' }}>
                                  {channel.name}
                                </span>
                                <span className="chat-time">{channel.time}</span>
                              </div>
                              <div className="chat-title" style={{ fontSize: '11px', color: 'var(--text-sub)' }}>
                                {channel.title}
                              </div>
                              <p className="chat-preview">{channel.preview}</p>
                            </div>
                            {(() => {
                              const b = getChannelBadge(channel.status, null);
                              return (
                                <span className="status-badge" style={{ backgroundColor: b.bg, color: b.color }}>
                                  {b.label}
                                </span>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sub)', fontSize: '13px' }}>
              チャットが見つかりませんでした。
            </div>
          )}
        </div>
      </main>

      <div className={`overlay-view ${activeChat ? 'show' : ''}`} style={{ display: activeChat ? 'flex' : 'none', transform: activeChat ? 'translateX(0)' : 'translateX(100%)' }}>
        <header className="solid-header overlay-header chat-header-fixed" style={{ height: 'auto', paddingBottom: '12px' }}>
          <div className="chat-header-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button className="icon-btn-dark" onClick={() => window.history.back()}>
              <span className="material-symbols-outlined">arrow_back_ios_new</span>
            </button>
            <div 
              className="chat-header-title" 
              onClick={() => {
                if (activeChat && activeChat.status !== 'group') {
                  const oppCompanyId = activeChat.id.replace('chat_', '').replace(currentUser?.id, '').replace('_', '');
                  const oppCompany = allCompanies.find(c => c.id === oppCompanyId);
                  if (oppCompany) {
                    setClickedCompanyProfile(oppCompany);
                    setClickedStaffProfile(null);
                    setShowProfileModal(true);
                  }
                }
              }}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                overflow: 'hidden', 
                minWidth: 0, 
                padding: '0 8px',
                cursor: activeChat?.status !== 'group' ? 'pointer' : 'default'
              }}
            >
              <h1 style={{ fontSize: '14px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {headerTitle}
              </h1>
              <div style={{ fontSize: '11px', color: 'var(--text-sub)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeChat?.title}
              </div>
            </div>
            <button
              className="icon-btn-dark"
              onClick={() => setShowMembersModal(true)}
              title="参加メンバー"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>groups</span>
            </button>
          </div>

          {relatedTask && relatedTask.jobId && relatedTask.jobId !== 'chat' && (
            !contractApproved ? (
              <div 
                onClick={() => setShowContractModal(true)}
                style={{
                  background: workDateNear ? '#FEE2E2' : '#FFFBEB',
                  border: workDateNear ? '1px solid #FCA5A5' : '1px solid #FEF3C7',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginTop: '8px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 'bold', color: workDateNear ? '#991B1B' : '#B45309', textAlign: 'left' }}>
                  <span className="material-symbols-outlined" style={{ color: workDateNear ? '#DC2626' : '#F59E0B', fontSize: '16px' }}>
                    {workDateNear ? 'gavel' : 'warning'}
                  </span>
                  <span>
                    {workDateNear 
                      ? '🚨 稼働直前ですが契約書が未承認です！' 
                      : '⚠️ 契約書が未承認です。稼働前の相互承認を推奨します。'}
                  </span>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: workDateNear ? '#991B1B' : '#B45309' }}>
                  chevron_right
                </span>
              </div>
            ) : (
              <div 
                onClick={() => setShowContractModal(true)}
                style={{
                  background: '#ECFDF5',
                  border: '1px solid #A7F3D0',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginTop: '8px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 'bold', color: '#065F46', textAlign: 'left' }}>
                  <span className="material-symbols-outlined" style={{ color: '#10B981', fontSize: '16px' }}>
                    verified
                  </span>
                  <span>🤝 業務委託契約 相互承認済み</span>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#065F46' }}>
                  chevron_right
                </span>
              </div>
            )
          )}

          {activeChat?.status === 'offered' && !isClient && (
            <div style={{
              background: '#FFFBEB',
              border: '1px solid #FEF3C7',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              alignItems: 'center',
              marginTop: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 'bold', color: '#B45309', textAlign: 'left', width: '100%' }}>
                <span className="material-symbols-outlined" style={{ color: '#F59E0B', fontSize: '18px' }}>campaign</span>
                <span>内定（契約オファー）を受信しました。</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <button 
                  onClick={() => {
                    setSelectedOfferMsg(null);
                    setShowOfferModal(true);
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#D97706',
                    color: 'white',
                    fontSize: '11.5px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    textAlign: 'center',
                    boxShadow: '0 2px 4px rgba(217, 119, 6, 0.2)'
                  }}
                >
                  【内定通知を開く】
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="list-area bg-gray p-16 chat-timeline" ref={chatTimelineRef} style={{ paddingTop: headerHeight }}>
          {mappedMessages.map((msg, i) => (
            <div key={i}>
              {msg.type === 'system' && (
                <div className="chat-system-message" style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <span style={{ whiteSpace: 'pre-wrap', textAlign: 'center', lineHeight: '1.5' }}>{msg.text}</span>
                  {msg.linkToChatId && (
                    <button
                      onClick={() => {
                        setActiveChatId(msg.linkToChatId);
                        window.history.pushState({ activeChatId: msg.linkToChatId }, '');
                      }}
                      style={{
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: '0 2px 4px rgba(99, 102, 241, 0.2)',
                        marginTop: '4px',
                        transition: 'transform 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'none'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>chat</span>
                      現場グループチャットを開く
                    </button>
                  )}
                </div>
              )}
              {msg.type === 'received' && (
                <div className="message-row received" style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div 
                    className="chat-avatar bg-blue" 
                    onClick={() => handleAvatarClick(msg)}
                    style={{ fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    {msg.avatar || activeChat?.avatar}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                    {msg.senderName && (
                      // 直接チャットでも送信者(会社名 担当者)を明示。
                      // 同じ相手企業の別担当者からの返信を取り違えないため。
                      <div style={{ fontSize: '10px', color: 'var(--text-sub)', marginLeft: '4px', marginBottom: '2px' }}>
                        {String(msg.senderName).replace('_', ' ')}
                      </div>
                    )}
                    {msg.isReceipt || msg.isArrangement || msg.isPhoto || msg.isLocation ? (
                      <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {msg.isReceipt ? renderReceiptCard(msg) : 
                         msg.isArrangement ? renderArrangementCard(msg) : 
                         msg.isPhoto ? renderPhotoCard(msg) : 
                         renderLocationCard(msg)}
                        <span className="message-time" style={{ alignSelf: 'flex-start', margin: '4px 4px 0 4px' }}>{msg.time}</span>
                      </div>
                    ) : (
                      <div className="message-bubble">
                        {msg.isProposal ? (
                          <div className="contract-card" style={{ background: 'var(--surface-color)', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '12px', width: '100%', maxWidth: '220px', boxSizing: 'border-box' }}>
                            <div className="contract-header" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '8px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>description</span>
                              <span style={{ fontSize: '13px' }}>電子発注書</span>
                            </div>
                            <div className="contract-body" style={{ fontSize: '11px', color: 'var(--text-main)', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div><strong>案件名:</strong> {msg.proposalDetails?.title || activeChat?.title}</div>
                              <div><strong>単価:</strong> {msg.proposalDetails?.price || '15,000円 / 日'}</div>
                              <div><strong>期間:</strong> {msg.proposalDetails?.duration || '10/14 - 10/15 (2日間)'}</div>
                            </div>
                            {msg.proposalStatus === 'pending' ? (
                              <button className="btn-primary btn-small w-full" onClick={() => handleOpenSignatureModal(msg.id)} style={{ background: 'var(--primary)', color: '#FFFFFF', border: 'none', fontSize: '11px', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>draw</span>
                                手書き電子サインをして同意
                              </button>
                            ) : (
                              <div>
                                <button className="btn-primary btn-small w-full" disabled style={{ background: '#DEF7EC', color: '#03543F', border: 'none', fontSize: '11px', padding: '6px', borderRadius: '4px', cursor: 'not-allowed', fontWeight: 'bold', width: '100%', marginBottom: '4px' }}>
                                  ✓ 契約成立済み (署名完了)
                                </button>
                                {msg.signatureDataUrl && (
                                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '4px', borderRadius: '4px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '9px', color: '#64748B', marginBottom: '2px' }}>電子署名確認:</div>
                                    <img src={msg.signatureDataUrl} alt="Signature" style={{ maxHeight: '36px', maxWidth: '100%', objectFit: 'contain' }} />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : msg.isOffer ? (
                          <div style={{ background: 'var(--surface-color)', border: '1px solid #FEF3C7', borderRadius: '12px', padding: '14px', width: '100%', maxWidth: '230px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', boxSizing: 'border-box' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: '#D97706', marginBottom: '10px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>workspace_premium</span>
                              <span style={{ fontSize: '13px' }}>内定通知オファー</span>
                            </div>
                            
                            <div style={{ fontSize: '11px', color: '#4B5563', marginBottom: '12px', lineHeight: '1.5', textAlign: 'left' }}>
                              選考の結果、以下の案件について内定オファーが届いています。条件をご確認ください。
                            </div>

                            <div style={{ fontSize: '11px', color: 'var(--text-main)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', background: '#FFFDF5', padding: '10px', borderRadius: '8px', border: '1px solid #FEF3C7' }}>
                              {relatedJob?.jobCode && <div><strong>案件コード:</strong> <span style={{ color: '#0F172A', fontWeight: 'bold' }}>{relatedJob.jobCode}</span></div>}
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>案件名:</strong> <span style={{ color: '#0F172A', fontWeight: 'bold' }}>{relatedJob?.title || activeChat?.title}</span></div>
                              <div><strong>契約金額:</strong> <span style={{ color: '#D97706', fontWeight: 'bold' }}>{relatedJob?.price || '15,000円 / 日'}</span></div>
                              <div><strong>日程:</strong> <span style={{ color: '#0F172A' }}>{relatedJob?.eventDate || '調整中'}</span></div>
                            </div>

                            <button
                              onClick={() => {
                                setSelectedOfferMsg(msg);
                                setShowOfferModal(true);
                              }}
                              style={{
                                background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                                color: '#FFFFFF',
                                border: 'none',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                width: '100%',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                boxShadow: '0 4px 6px rgba(217, 119, 6, 0.2)',
                                transition: 'all 0.2s'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
                              内定通知を開く
                            </button>
                          </div>
                        ) : (
                          <p style={{ whiteSpace: 'pre-wrap' }}>{maskContactInfo(msg.text)}</p>
                        )}
                        <span className="message-time">{msg.time}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {msg.type === 'sent' && (
                <div className="message-row sent" style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1, minWidth: 0 }}>
                    {activeChat?.status === 'group' && (
                      <div style={{ fontSize: '10px', color: 'var(--text-sub)', marginRight: '4px', marginBottom: '2px', textAlign: 'right' }}>
                        {(msg.senderName || '自分').replace('_', ' ')}
                      </div>
                    )}
                    {msg.isReceipt || msg.isArrangement || msg.isPhoto || msg.isLocation ? (
                      <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                        {msg.isReceipt ? renderReceiptCard(msg) : 
                         msg.isArrangement ? renderArrangementCard(msg) : 
                         msg.isPhoto ? renderPhotoCard(msg) : 
                         renderLocationCard(msg)}
                        <span className="message-time" style={{ alignSelf: 'flex-end', margin: '4px 4px 0 4px' }}>{msg.time}</span>
                      </div>
                    ) : (
                      <div className="message-bubble">
                        {msg.isProposal ? (
                          <div className="contract-card" style={{ background: 'var(--surface-color)', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '12px', width: '100%', maxWidth: '220px', boxSizing: 'border-box' }}>
                            <div className="contract-header" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '8px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>description</span>
                              <span style={{ fontSize: '13px' }}>電子発注書</span>
                            </div>
                            <div className="contract-body" style={{ fontSize: '11px', color: 'var(--text-main)', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div><strong>案件名:</strong> {msg.proposalDetails?.title || activeChat?.title}</div>
                              <div><strong>単価:</strong> {msg.proposalDetails?.price || '15,000円 / 日'}</div>
                              <div><strong>期間:</strong> {msg.proposalDetails?.duration || '10/14 - 10/15 (2日間)'}</div>
                            </div>
                            {msg.proposalStatus === 'pending' ? (
                              <button className="btn-primary btn-small w-full" disabled style={{ background: 'var(--bg-gray)', color: 'var(--text-sub)', border: '1px solid var(--border-color)', fontSize: '11px', padding: '6px', borderRadius: '4px', cursor: 'not-allowed', width: '100%' }}>
                                相手の承認待ち...
                              </button>
                            ) : (
                              <button className="btn-primary btn-small w-full" disabled style={{ background: '#DEF7EC', color: '#03543F', border: 'none', fontSize: '11px', padding: '6px', borderRadius: '4px', cursor: 'not-allowed', fontWeight: 'bold', width: '100%' }}>
                                契約成立済み
                              </button>
                            )}
                          </div>
                        ) : msg.isOffer ? (
                          <div style={{ background: 'var(--surface-color)', border: '1px solid #FEF3C7', borderRadius: '12px', padding: '14px', width: '100%', maxWidth: '230px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', boxSizing: 'border-box' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: '#D97706', marginBottom: '10px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>workspace_premium</span>
                              <span style={{ fontSize: '13px' }}>内定通知オファー</span>
                            </div>
                            
                            <div style={{ fontSize: '11px', color: '#4B5563', marginBottom: '12px', lineHeight: '1.5', textAlign: 'left' }}>
                              下請け企業に対し、以下の条件で内定オファーを提示しました（回答待ち）。
                            </div>

                            <div style={{ fontSize: '11px', color: 'var(--text-main)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', background: '#FFFDF5', padding: '10px', borderRadius: '8px', border: '1px solid #FEF3C7' }}>
                              {relatedJob?.jobCode && <div><strong>案件コード:</strong> <span style={{ color: '#0F172A', fontWeight: 'bold' }}>{relatedJob.jobCode}</span></div>}
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>案件名:</strong> <span style={{ color: '#0F172A', fontWeight: 'bold' }}>{relatedJob?.title || activeChat?.title}</span></div>
                              <div><strong>契約金額:</strong> <span style={{ color: '#D97706', fontWeight: 'bold' }}>{relatedJob?.price || '15,000円 / 日'}</span></div>
                              <div><strong>日程:</strong> <span style={{ color: '#0F172A' }}>{relatedJob?.eventDate || '調整中'}</span></div>
                              {offerExpiry.hasExpiry && (
                                <div style={{ color: offerExpiry.isExpired ? '#B91C1C' : offerExpiry.isSoon ? '#D97706' : '#64748B', fontWeight: 'bold' }}>
                                  {offerExpiry.label}
                                </div>
                              )}
                            </div>

                            <button
                              onClick={() => {
                                setSelectedOfferMsg(msg);
                                setShowOfferModal(true);
                              }}
                              style={{
                                background: 'var(--surface-color)',
                                color: '#D97706',
                                border: '1px solid #D97706',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                width: '100%',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                transition: 'all 0.2s'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>visibility</span>
                              条件を確認する
                            </button>
                            {isClient && activeChat?.status === 'offered' && !offerExpiry.isExpired && (
                              <button
                                onClick={handleSendOfferReminder}
                                disabled={sendingOfferReminder}
                                style={{
                                  marginTop: '6px',
                                  background: 'none',
                                  color: '#D97706',
                                  border: 'none',
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  width: '100%',
                                  textDecoration: 'underline',
                                }}
                              >
                                {sendingOfferReminder ? '送信中...' : '相手にリマインドを送る'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <p style={{ whiteSpace: 'pre-wrap' }}>{maskContactInfo(msg.text)}</p>
                        )}
                        <span className="message-time">{msg.time}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </main>

        <footer className="chat-footer">
          {/* Menu panel positioned absolutely above the footer */}
          {showChatMenu && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: '16px',
              right: '16px',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(10px)',
              borderRadius: '16px',
              border: '1px solid rgba(226, 232, 240, 0.8)',
              boxShadow: '0 -10px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 20px -5px rgba(0, 0, 0, 0.08)',
              padding: '16px',
              marginBottom: '10px',
              zIndex: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              animation: 'slideUp 0.2s ease-out'
            }}>
              {activeChat?.status !== 'group' && (
                <div className="chat-conditions-pin" style={{ gridColumn: 'span 3', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <div className="condition-summary">
                    {(() => {
                      const engagement = getEngagementStatusLabel(activeChat?.status || '', relatedJob, {
                        viewer: isClient ? 'client' : 'agency',
                        contractApproved,
                      });
                      const b = getChannelBadge(activeChat?.status, relatedJob, {
                        viewer: isClient ? 'client' : 'agency',
                        contractApproved,
                      });
                      return (
                        <>
                          <span className="status-badge" style={{ margin: 0, backgroundColor: b.bg, color: b.color }}>
                            {b.label}
                          </span>
                          {engagement.subBadge && (
                            <span className="status-badge" style={{ margin: '0 0 0 4px', backgroundColor: '#FEF3C7', color: '#B45309' }}>
                              {engagement.subBadge}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    <div className="condition-details">
                      <span className="text-gray text-small">
                        {relatedJob?.jobCode && `案件コード: ${relatedJob.jobCode} / `}
                        単価: {relatedJob ? `${relatedJob.price.toLocaleString()}円 / 日` : '15,000円 / 日'}
                        {relatedJob?.eventDate ? ` / 期間: ${relatedJob.eventDate}` : ''}
                      </span>
                    </div>
                  </div>
                  {isClient && !hasApplications && (
                    <button 
                      className="btn-secondary btn-small"
                      onClick={handleOpenEditConditions}
                    >
                      条件を編集
                    </button>
                  )}
                </div>
              )}
              {[
                {
                  id: 'receipt',
                  label: '経費申請',
                  icon: 'receipt',
                  color: '#10B981',
                  bgColor: '#E6F4EA',
                  enabled: !isClient,
                   action: () => {
                    setReceiptCategory('transport');
                    setReceiptAmount(0);
                    setReceiptItem('');
                    setReceiptRoute('');
                    setReceiptNotes('');
                    setReceiptHotelName('');
                    setReceiptNights('');
                    setReceiptDistance('');
                    setReceiptGasolineRate(15);
                    setReceiptExpressway('');
                    setReceiptParking('');
                    setShowReceiptModal(true);
                    setShowChatMenu(false);
                  },
                  disabledMessage: '経費申請は下請け企業側の操作となります。'
                },
                {
                  id: 'receipt_list',
                  label: '領収書一覧・承認',
                  icon: 'receipt_long',
                  color: '#10B981',
                  bgColor: '#E6F4EA',
                  enabled: activeChat?.status !== 'group',
                  action: () => {
                    setShowReceiptsListModal(true);
                    setShowChatMenu(false);
                  },
                  disabledMessage: 'グループチャットでは領収書一覧の閲覧は行えません。'
                },
                {
                  id: 'arrange',
                  label: '手配情報共有',
                  icon: 'campaign',
                  color: '#3B82F6',
                  bgColor: '#E8F0FE',
                  enabled: isClient && (transportArranged || accommodationArranged),
                  action: () => {
                    setArrangementCategory(transportArranged ? 'transport' : 'accommodation');
                    setArrangementInfo('');
                    setShowArrangementModal(true);
                    setShowChatMenu(false);
                  },
                  disabledMessage: 'この案件は交通・宿泊のクライアント手配に対応していません。'
                },
                {
                  id: 'photo',
                  label: '写真を送信',
                  icon: 'photo_camera',
                  color: '#8B5CF6',
                  bgColor: '#F3E8FF',
                  enabled: true,
                  action: () => {
                    setSelectedPhotoUrl(photoOptions[0].url);
                    setPhotoCaption('');
                    setShowPhotoModal(true);
                    setShowChatMenu(false);
                  }
                },
                {
                  id: 'propose',
                  label: activeChat?.status === 'confirmed' ? '契約確定' : activeChat?.status === 'offered' ? '内定提示中' : (activeChat?.status === 'rejected' || activeChat?.status === 'declined') ? '選考終了' : (proposed ? '提案済' : '条件提案・発注'),
                  icon: 'edit_document',
                  color: '#EC4899',
                  bgColor: '#FCE7F3',
                  enabled: activeChat?.status !== 'group' && activeChat?.status !== 'confirmed' && activeChat?.status !== 'offered' && activeChat?.status !== 'rejected' && activeChat?.status !== 'declined' && !proposed,
                  action: () => {
                    handlePropose();
                    setShowChatMenu(false);
                  },
                  disabledMessage: activeChat?.status === 'group'
                    ? 'グループチャットでは発注提案は行えません。'
                    : ['confirmed', 'offered', 'rejected', 'declined'].includes(activeChat?.status || '')
                      ? 'すでに内定提示中か、契約が成立しているため提案は行えません。'
                      : 'すでに提案が送信されています。'
                }
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.enabled) {
                      item.action();
                    } else if (item.disabledMessage) {
                      alert(item.disabledMessage);
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 4px',
                    cursor: 'pointer',
                    opacity: item.enabled ? 1 : 0.4,
                    transition: 'all 0.2s',
                    outline: 'none'
                  }}
                >
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: item.bgColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    transition: 'transform 0.15s ease',
                    position: 'relative'
                  }} className="menu-icon-btn">
                    <span className="material-symbols-outlined" style={{ fontSize: '22px', color: item.color }}>{item.icon}</span>
                    {item.id === 'receipt_list' && pendingReceiptsCount > 0 && (
                      <span style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-4px',
                        background: '#EF4444',
                        color: 'white',
                        borderRadius: '50%',
                        width: '16px',
                        height: '16px',
                        fontSize: '9px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        boxShadow: '0 0 0 2px white'
                      }}>
                        {pendingReceiptsCount}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-main)', textAlign: 'center', whiteSpace: 'nowrap' }}>{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {activeChat?.status !== 'group' && (
            <div className="chat-actions-top">
              <button className="btn-primary btn-small w-full" onClick={handlePropose} disabled={proposed} style={{ opacity: proposed ? 0.7 : 1 }}>
                <span className="material-symbols-outlined icon-small">edit_document</span>
                {activeChat?.status === 'contracted' ? '契約成立済み' : (proposed ? '提案を発行しました' : 'この条件で発注（契約提案）')}
              </button>
            </div>
          )}
          <div className="chat-input-area">
            <button 
              className="icon-btn-dark text-gray"
              onClick={() => setShowChatMenu(!showChatMenu)}
              style={{ 
                background: showChatMenu ? '#E2E8F0' : 'transparent', 
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                padding: 0
              }}
            >
              <span 
                className="material-symbols-outlined"
                style={{ 
                  transform: showChatMenu ? 'rotate(45deg)' : 'none', 
                  transition: 'transform 0.2s ease-in-out',
                  color: showChatMenu ? '#475569' : 'var(--text-sub)'
                }}
              >
                add_circle
              </span>
            </button>

            <button
              onClick={() => setShowTemplateModal(true)}
              style={{
                background: '#EEF2FF',
                color: '#4338CA',
                border: '1px solid #C7D2FE',
                borderRadius: '16px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
              title="定型文テンプレートから挿入"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>description</span>
              定型文
            </button>
            <textarea
              className="form-control chat-textarea"
              placeholder="メッセージを入力..."
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              className="icon-btn-dark primary-text"
              disabled={!inputText.trim()}
              onClick={handleSend}
              style={{ opacity: inputText.trim() ? 1 : 0.5, cursor: inputText.trim() ? 'pointer' : 'not-allowed' }}
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </footer>
      </div>

      {/* 参加メンバー一覧モーダル */}
      {showMembersModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '100%',
            maxWidth: '360px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #EEF2F6 0%, #E2E8F0 100%)'
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>groups</span>
                参加メンバー一覧
              </h3>
              <button 
                onClick={() => setShowMembersModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748B'
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: '50vh', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {activeMembers.map((m, idx: number) => {
                const cleanName = m.label;
                const myPerson = currentUser?.staffName || currentUser?.representativeName || '';
                const isMe = !!myPerson && !!currentUser?.name && cleanName.includes(currentUser.name) && cleanName.includes(myPerson);
                const initial = cleanName.charAt(0);
                // 削除できる条件:
                //  - 「メンバー追加」で入った自社担当者(removableStaffId あり)
                //  - トークルーム開始時の各社1名(anchor)は誰でも削除不可
                //  - 自分自身は不可
                //  - 一般スタッフは管理者を削除できない(管理者は両方削除可)
                const iAmAdmin = currentUser?.staffRole === 'admin';
                const canRemove = !!m.removableStaffId
                  && m.companyId === currentUser?.id
                  && !isMe
                  && !m.isAnchor
                  && (iAmAdmin || m.role !== 'admin');

                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: '10px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: isMe ? 'var(--primary)' : '#6366F1',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '13px',
                      fontWeight: 'bold',
                      flexShrink: 0
                    }}>
                      {initial}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cleanName}
                      </span>
                      {isMe && (
                        <span style={{ alignSelf: 'flex-start', fontSize: '9px', background: '#DEF7EC', color: '#03543F', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', marginTop: '2px' }}>
                          ログイン中
                        </span>
                      )}
                      {!isMe && m.removableStaffId && (
                        <span style={{ alignSelf: 'flex-start', fontSize: '9px', background: '#EEF2FF', color: '#4338CA', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', marginTop: '2px' }}>
                          追加メンバー
                        </span>
                      )}
                    </div>
                    {canRemove && (
                      <button
                        onClick={() => handleRemoveMember(m.removableStaffId!, m.person)}
                        disabled={removingStaffId === m.removableStaffId}
                        title="このトークから削除"
                        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#B91C1C', display: 'flex', alignItems: 'center', padding: '4px' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>person_remove</span>
                      </button>
                    )}
                  </div>
                );
              })}

              {/* 自社メンバーの追加 */}
              {activeChat?.status !== 'group' && !showAddMemberPanel && (
                <button
                  onClick={() => setShowAddMemberPanel(true)}
                  disabled={addableStaffs.length === 0}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    padding: '10px 12px', borderRadius: '10px',
                    border: '1px dashed var(--primary)',
                    background: 'var(--surface-color)',
                    color: addableStaffs.length === 0 ? '#94A3B8' : 'var(--primary)',
                    fontSize: '12px', fontWeight: 'bold',
                    cursor: addableStaffs.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>person_add</span>
                  {addableStaffs.length === 0 ? '追加できる自社メンバーがいません' : '自社メンバーをトークに追加'}
                </button>
              )}

              {showAddMemberPanel && (
                <div style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#0F172A' }}>追加する自社メンバーを選択</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '30vh', overflowY: 'auto' }}>
                    {addableStaffs.map((s: any) => {
                      const checked = addMemberSelection.has(s.id);
                      return (
                        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', padding: '4px 2px' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = new Set(addMemberSelection);
                              if (checked) next.delete(s.id); else next.add(s.id);
                              setAddMemberSelection(next);
                            }}
                          />
                          <span>{s.name}{s.role === 'admin' ? '（管理者）' : ''}</span>
                        </label>
                      );
                    })}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', borderTop: '1px solid #F1F5F9', paddingTop: '8px' }}>
                    <input
                      type="checkbox"
                      checked={addMemberShareHistory}
                      onChange={() => setAddMemberShareHistory(v => !v)}
                    />
                    <span>これまでのトーク内容も共有する</span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setShowAddMemberPanel(false); setAddMemberSelection(new Set()); }}
                      style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', background: 'var(--surface-color)', color: '#64748B', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      やめる
                    </button>
                    <button
                      onClick={handleAddMembers}
                      disabled={addMemberSelection.size === 0 || addingMembers}
                      style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: addMemberSelection.size === 0 ? '#CBD5E1' : 'var(--primary)', color: '#fff', fontSize: '12px', fontWeight: 'bold', cursor: addMemberSelection.size === 0 ? 'not-allowed' : 'pointer' }}
                    >
                      {addingMembers ? '追加中...' : `追加する${addMemberSelection.size ? `(${addMemberSelection.size})` : ''}`}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end', background: '#F8FAFC' }}>
              <button
                onClick={() => { setShowMembersModal(false); setShowAddMemberPanel(false); setAddMemberSelection(new Set()); }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #E2E8F0',
                  background: 'var(--surface-color)',
                  color: '#64748B',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内定通知詳細モーダル */}
      {showOfferModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '100%',
            maxWidth: '400px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #EEF2F6 0%, #E2E8F0 100%)'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>verified</span>
                内定通知書
              </h3>
              <button 
                onClick={() => {
                  setShowOfferModal(false);
                  setConfirmingOfferAction(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748B'
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: '70vh' }}>
              {selectedOfferMsg && <span style={{ display: 'none' }}>{selectedOfferMsg.id}</span>}
              {confirmingOfferAction === null ? (
                <>
                  <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>クライアント企業</div>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#0F172A' }}>{clientName}</div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '4px' }}>から内定オファーが届いています。</div>
                  </div>

                  <div style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    fontSize: '13px',
                    color: '#334155',
                    marginBottom: '20px'
                  }}>
                    <div>
                      <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>案件コード</strong>
                      <span style={{ fontWeight: 'bold', color: '#0F172A' }}>{relatedJob?.jobCode || '未発行'}</span>
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: 0 }} />
                    <div>
                      <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>案件名</strong>
                      <span style={{ fontWeight: 'bold', color: '#0F172A' }}>{relatedJob?.title || activeChat?.title}</span>
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: 0 }} />
                    <div>
                      <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>契約単価</strong>
                      <span style={{ fontWeight: 'bold', color: 'var(--primary)', fontSize: '14px' }}>
                        {relatedJob?.price || '15,000円 / 日'}
                      </span>
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: 0 }} />
                    <div>
                      <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>日程</strong>
                      <span>{relatedJob?.eventDate || '未定'}</span>
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: 0 }} />
                    <div>
                      <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>勤務地</strong>
                      <span>{relatedJob?.workLocation || '未定'}</span>
                    </div>
                    {offerExpiry.hasExpiry && (
                      <>
                        <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: 0 }} />
                        <div>
                          <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>オファーの有効期限</strong>
                          <span style={{ fontWeight: 'bold', color: offerExpiry.isExpired ? '#B91C1C' : offerExpiry.isSoon ? '#D97706' : '#0F172A' }}>
                            {offerExpiry.label}
                          </span>
                        </div>
                      </>
                    )}
                    {relatedJob?.description && (
                      <>
                        <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: 0 }} />
                        <div>
                          <strong style={{ color: '#64748B', display: 'block', fontSize: '11px', marginBottom: '2px' }}>詳細内容</strong>
                          <span style={{ fontSize: '12px', whiteSpace: 'pre-wrap', color: '#475569' }}>{relatedJob.description}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {sbApprovalGate.required && (
                    <div style={{
                      padding: '12px',
                      borderRadius: '9px',
                      border: `1px solid ${sbApprovalGate.valid ? '#86EFAC' : '#FDBA74'}`,
                      background: sbApprovalGate.valid ? '#F0FDF4' : '#FFF7ED',
                      color: sbApprovalGate.valid ? '#166534' : '#9A3412',
                      fontSize: '12px',
                      lineHeight: '1.55'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', marginBottom: '4px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{sbApprovalGate.valid ? 'verified_user' : 'gpp_maybe'}</span>
                        {sbApprovalGate.valid ? 'SB再委託承認済み' : 'SB再委託承認 未確認'}
                      </div>
                      {sbApprovalGate.valid && sbApprovalGate.record ? (
                        <div>
                          管理番号: {sbApprovalGate.record.approvalNumber}<br />
                          承諾日: {sbApprovalGate.record.approvedOn}
                          {sbApprovalGate.record.validUntil ? ` ／ 有効期限: ${sbApprovalGate.record.validUntil}` : ''}
                        </div>
                      ) : (
                        <div>{sbApprovalGate.reason} 契約確定・スタッフ確定・現場グループ作成は停止されています。</div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {!isClient && offerExpiry.isExpired ? (
                      <div style={{ textAlign: 'center', fontSize: '12px', color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FEE2E2', padding: '10px', borderRadius: '8px' }}>
                        このオファーは有効期限が切れています。承諾するにはクライアント企業に再オファーを依頼してください。
                      </div>
                    ) : !isClient ? (
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => setConfirmingOfferAction('decline')}
                          style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid #EF4444',
                            background: 'var(--surface-color)',
                            color: '#EF4444',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          辞退する
                        </button>
                        <button
                          onClick={() => setConfirmingOfferAction('accept')}
                          disabled={sbApprovalGate.required && !sbApprovalGate.valid}
                          style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            border: 'none',
                            background: sbApprovalGate.required && !sbApprovalGate.valid ? '#CBD5E1' : '#10B981',
                            color: '#FFFFFF',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            cursor: sbApprovalGate.required && !sbApprovalGate.valid ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: sbApprovalGate.required && !sbApprovalGate.valid ? 'none' : '0 4px 6px -1px rgba(16, 185, 129, 0.2)'
                          }}
                        >
                          承諾する
                        </button>
                      </div>
                    ) : (
                      <div style={{
                        textAlign: 'center',
                        fontSize: '12px',
                        color: '#64748B',
                        background: '#F1F5F9',
                        padding: '10px',
                        borderRadius: '8px'
                      }}>
                        ※ 内定の承諾・辞退は下請け企業（相手側）の操作となります。
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setShowOfferModal(false);
                        setConfirmingOfferAction(null);
                      }}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #E2E8F0',
                        background: '#F8FAFC',
                        color: '#64748B',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      閉じる
                    </button>
                  </div>
                </>
              ) : confirmingOfferAction === 'accept' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: '#DEF7EC',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 12px auto'
                    }}>
                      <span className="material-symbols-outlined" style={{ color: '#059669', fontSize: '28px' }}>check_circle</span>
                    </div>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 'bold', color: '#0F172A' }}>内定の承諾確認</h4>
                    <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.6', textAlign: 'left' }}>
                      本当にこの内定を<strong>承諾</strong>しますか？<br />
                      承諾すると契約が確定し、案件ステータスが「契約成立」となります。また、現場連絡用のグループチャットが開設されます。
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setConfirmingOfferAction(null)}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid #E2E8F0',
                        background: 'var(--surface-color)',
                        color: '#64748B',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      戻る
                    </button>
                    <button
                      onClick={async () => {
                        setShowOfferModal(false);
                        setConfirmingOfferAction(null);
                        await handleAcceptUnofficialOffer();
                      }}
                      disabled={sbApprovalGate.required && !sbApprovalGate.valid}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: sbApprovalGate.required && !sbApprovalGate.valid ? '#CBD5E1' : '#10B981',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: sbApprovalGate.required && !sbApprovalGate.valid ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)'
                      }}
                    >
                      承諾を確定する
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: '#FEE2E2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 12px auto'
                    }}>
                      <span className="material-symbols-outlined" style={{ color: '#DC2626', fontSize: '28px' }}>error</span>
                    </div>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 'bold', color: '#0F172A' }}>内定の辞退確認</h4>
                    <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: '1.6', textAlign: 'left' }}>
                      本当にこの内定を<strong>辞退</strong>しますか？<br />
                      辞退すると選考が終了し、辞退した旨が相手企業に通知されます。この操作は取り消せません。
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setConfirmingOfferAction(null)}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid #E2E8F0',
                        background: 'var(--surface-color)',
                        color: '#64748B',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      戻る
                    </button>
                    <button
                      onClick={async () => {
                        setShowOfferModal(false);
                        setConfirmingOfferAction(null);
                        await handleDeclineUnofficialOffer(true);
                      }}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#EF4444',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.2)'
                      }}
                    >
                      辞退を確定する
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 業務委託契約の相互承認モーダル */}
      {showContractModal && relatedTask && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '100%',
            maxWidth: '440px',
            maxHeight: '85vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #EEF2F6 0%, #E2E8F0 100%)'
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>gavel</span>
                業務委託契約の相互承認
              </h3>
              <button 
                onClick={() => setShowContractModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#FFFBEB', border: '1px solid #FEF3C7', padding: '10px 12px', borderRadius: '8px', fontSize: '11px', color: '#B45309', lineHeight: '1.5' }}>
                💡 <strong>契約承認ポリシー</strong><br />
                システム上、契約承認が「未承認」の状態でもスタッフの稼働自体は可能ですが、未承認状態でのトラブルに関して運営会社は一切の責任を負いません。トラブル防止のため、稼働前の相互承認を強く推奨します。
              </div>

              {/* Status details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                <div><strong>案件名:</strong> {relatedTask.jobTitle}</div>
                <div><strong>稼働予定日:</strong> {relatedTask.date}</div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#F8FAFC', padding: '8px 12px', borderRadius: '6px', border: '1px solid #F1F5F9', marginTop: '4px' }}>
                  <div>
                    <strong>甲（発注側）の署名:</strong>{' '}
                    <span style={{ color: relatedTask.clientContractApprovedByClient ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                      {relatedTask.clientContractApprovedByClient ? '済' : '未'}
                    </span>
                  </div>
                  <div>
                    <strong>乙（受注側）の署名:</strong>{' '}
                    <span style={{ color: relatedTask.clientContractApprovedByAgency ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                      {relatedTask.clientContractApprovedByAgency ? '済' : '未'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Document Text */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <strong style={{ fontSize: '12px', color: '#334155' }}>契約書面内容:</strong>
                {relatedTask.clientContractPdf ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      height: '240px',
                      background: '#F8FAFC',
                      position: 'relative'
                    }}>
                      <iframe 
                        src={relatedTask.clientContractPdf} 
                        width="100%" 
                        height="100%" 
                        style={{ border: 'none' }}
                        title="PDF Contract Preview"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const win = window.open();
                        if (win) win.document.write(`<iframe src="${relatedTask.clientContractPdf}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                      }}
                      style={{
                        padding: '8px',
                        background: '#EFF6FF',
                        border: '1px solid #BFDBFE',
                        color: 'var(--primary)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_new</span>
                      PDF契約書を別窓で表示
                    </button>
                  </div>
                ) : (
                  <div style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    padding: '12px',
                    background: '#F8FAFC',
                    fontSize: '11px',
                    lineHeight: '1.6',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '200px',
                    overflowY: 'auto'
                  }}>
                    {relatedTask.clientContractText || '契約テンプレートが登録されていません。'}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', gap: '10px', background: '#F8FAFC' }}>
              <button
                onClick={() => setShowContractModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #E2E8F0', background: 'var(--surface-color)', color: '#64748B', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                キャンセル
              </button>
              
              {/* Approval Buttons */}
              {isClient ? (
                relatedTask.clientContractApprovedByClient ? (
                  <button disabled style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#DEF7EC', color: '#03543F', fontSize: '13px', fontWeight: 'bold', cursor: 'not-allowed' }}>
                    甲（自社）署名済み
                  </button>
                ) : (
                  <button
                    onClick={handleSignContract}
                    style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#FFFFFF', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.2)' }}
                  >
                    甲として署名（承認）する
                  </button>
                )
              ) : (
                relatedTask.clientContractApprovedByAgency ? (
                  <button disabled style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#DEF7EC', color: '#03543F', fontSize: '13px', fontWeight: 'bold', cursor: 'not-allowed' }}>
                    乙（自社）署名済み
                  </button>
                ) : (
                  <button
                    onClick={handleSignContract}
                    style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#FFFFFF', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.2)' }}
                  >
                    乙として署名（承認）する
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* 企業・スタッフ詳細プロフィールポップアップ */}
      {showProfileModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div onClick={() => setShowProfileModal(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 }} />
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '100%',
            maxWidth: '350px',
            maxHeight: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #EEF2F6 0%, #E2E8F0 100%)'
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>
                  {clickedCompanyProfile ? 'business' : 'person'}
                </span>
                {clickedCompanyProfile ? '取引先企業情報' : 'パートナーメンバー情報'}
              </h3>
              <button 
                onClick={() => setShowProfileModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {clickedCompanyProfile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="profile-avatar" style={{ width: '48px', height: '48px', fontSize: '18px', borderRadius: '50%' }}>
                      {clickedCompanyProfile.name.charAt(0)}
                    </div>
                    <div>
                      <h4 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)' }}>{clickedCompanyProfile.name}</h4>
                      <span style={{ fontSize: '10px', background: '#EFF6FF', color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', marginTop: '4px', display: 'inline-block' }}>
                        {clickedCompanyProfile.companyType === 'client' ? '発注企業' : clickedCompanyProfile.companyType === 'agency' ? '受注企業' : '発注・受注兼任'}
                      </span>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                    <div><strong>代表者/担当者:</strong> {clickedCompanyProfile.representativeName || '未登録'} ({clickedCompanyProfile.gender || '男性'})</div>
                    {clickedCompanyProfile.email && <div><strong>メールアドレス:</strong> {clickedCompanyProfile.email}</div>}
                    <div><strong>電話番号:</strong> {clickedCompanyProfile.phone || '090-1234-5678'}</div>
                    {clickedCompanyProfile.website && (
                      <div>
                        <strong>ホームページ:</strong>{' '}
                        <a href={clickedCompanyProfile.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                          {clickedCompanyProfile.website}
                        </a>
                      </div>
                    )}
                    {clickedCompanyProfile.address && <div><strong>本社所在地:</strong> {clickedCompanyProfile.address}</div>}
                  </div>
                  
                  {clickedCompanyProfile.prText && (
                    <div style={{ background: '#F8FAFC', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', color: '#475569', lineHeight: '1.5' }}>
                      <strong>企業紹介・得意分野:</strong>
                      <p style={{ margin: '4px 0 0 0' }}>{clickedCompanyProfile.prText}</p>
                    </div>
                  )}
                </div>
              )}
              
              {clickedStaffProfile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="profile-avatar bg-blue" style={{ width: '48px', height: '48px', fontSize: '18px', borderRadius: '50%' }}>
                      {clickedStaffProfile.name.charAt(0)}
                    </div>
                    <div>
                      <h4 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)' }}>
                        {isClient || activeChat?.status === 'group' || (activeChat?.status as any) === 'contracted' || activeChat?.status === 'confirmed' || (activeChat?.status as any) === 'completed'
                          ? clickedStaffProfile.name
                          : (clickedStaffProfile.maskedName || 'パートナー登録メンバー')}
                      </h4>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', background: '#F1F5F9', color: '#475569', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                          {clickedStaffProfile.gender || '男性'}
                        </span>
                        {clickedStaffProfile.birthday && (
                          <span style={{ fontSize: '10px', background: '#F1F5F9', color: '#475569', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                            {new Date().getFullYear() - new Date(clickedStaffProfile.birthday).getFullYear()}歳
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                    {clickedStaffProfile.baseLocation && <div><strong>活動拠点:</strong> {clickedStaffProfile.baseLocation}</div>}
                    {clickedStaffProfile.nearestStation && <div><strong>最寄り駅:</strong> {clickedStaffProfile.nearestStation}</div>}
                    <div><strong>契約単価:</strong> ¥{clickedStaffProfile.price.toLocaleString()} / 日</div>
                    {clickedStaffProfile.skills && clickedStaffProfile.skills.length > 0 && (
                      <div><strong>保有スキル:</strong> {clickedStaffProfile.skills.join(', ')}</div>
                    )}
                    {clickedStaffProfile.completedTrainings && clickedStaffProfile.completedTrainings.length > 0 && (
                      <div>
                        <strong>受講済みの研修:</strong>{' '}
                        {clickedStaffProfile.completedTrainings.map((tId: string) => {
                          const tr = allTrainings.find((t: any) => t.id === tId);
                          return tr ? tr.title : tId;
                        }).join(', ')}
                      </div>
                    )}
                  </div>
                  
                  {clickedStaffProfile.prText && (
                    <div style={{ background: '#F8FAFC', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', color: '#475569', lineHeight: '1.5' }}>
                      <strong>自己紹介・経歴:</strong>
                      <p style={{ margin: '4px 0 0 0' }}>{clickedStaffProfile.prText}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end', background: '#F8FAFC' }}>
              <button
                onClick={() => setShowProfileModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #E2E8F0', background: 'var(--surface-color)', color: '#64748B', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 領収書提出モーダル */}
      {showReceiptModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '12px',
            padding: '20px',
            width: '100%',
            maxWidth: '360px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            textAlign: 'left'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ color: '#10B981' }}>receipt_long</span>
              経費申請
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>経費種別 *</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button 
                    type="button" 
                    onClick={() => {
                      setReceiptCategory('transport');
                      setReceiptItem('');
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: '6px',
                      border: receiptCategory === 'transport' ? '2px solid #10B981' : '1px solid #E2E8F0',
                      background: receiptCategory === 'transport' ? '#DEF7EC' : 'white',
                      color: receiptCategory === 'transport' ? '#03543F' : 'var(--text-main)',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    公共交通機関
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setReceiptCategory('accommodation');
                      setReceiptItem('');
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: '6px',
                      border: receiptCategory === 'accommodation' ? '2px solid #10B981' : '1px solid #E2E8F0',
                      background: receiptCategory === 'accommodation' ? '#DEF7EC' : 'white',
                      color: receiptCategory === 'accommodation' ? '#03543F' : 'var(--text-main)',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    宿泊費
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setReceiptCategory('car');
                      setReceiptItem('車移動経費');
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: '6px',
                      border: receiptCategory === 'car' ? '2px solid #10B981' : '1px solid #E2E8F0',
                      background: receiptCategory === 'car' ? '#DEF7EC' : 'white',
                      color: receiptCategory === 'car' ? '#03543F' : 'var(--text-main)',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    車移動
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>金額（税込） *</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '10px', fontSize: '14px', color: 'var(--text-sub)' }}>¥</span>
                  <input 
                    type="number"
                    className="no-spin"
                    value={receiptAmount || ''}
                    onChange={e => setReceiptAmount(Number(e.target.value))}
                    onWheel={e => e.currentTarget.blur()}
                    placeholder="0"
                    readOnly={receiptCategory === 'car'}
                    disabled={receiptCategory === 'car'}
                    style={{
                      width: '100%',
                      padding: '8px 8px 8px 24px',
                      borderRadius: '6px',
                      border: '1px solid #ccc',
                      fontSize: '14px',
                      backgroundColor: receiptCategory === 'car' ? '#F3F4F6' : 'white',
                      color: receiptCategory === 'car' ? '#9CA3AF' : '#1F2937'
                    }}
                  />
                </div>
                {relatedJob && (
                  <div style={{ fontSize: '11px', color: '#B45309', marginTop: '2px' }}>
                    {receiptCategory === 'transport' && relatedJob.expenses?.transportValue ? (
                      `※公共交通機関上限額: ¥${relatedJob.expenses.transportValue.toLocaleString()} / 日`
                    ) : receiptCategory === 'accommodation' && relatedJob.expenses?.accommodationValue ? (
                      `※宿泊費上限額: ¥${relatedJob.expenses.accommodationValue.toLocaleString()} / 泊`
                    ) : receiptCategory === 'car' ? (
                      '※ガソリン代・高速代・駐車場代の合計値が自動反映されます'
                    ) : (
                      '※上限設定はありません（実費支給）'
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>
                  {receiptCategory === 'car' ? '証明画像 *' : '領収書画像 *'}
                </label>
                <div style={{
                  border: '1.5px dashed #10B981',
                  borderRadius: '8px',
                  padding: '12px',
                  textAlign: 'center',
                  background: '#F0FDF4',
                  cursor: 'pointer'
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '28px', color: '#10B981' }}>photo_camera</span>
                  <div style={{ fontSize: '11px', color: '#047857', fontWeight: 'bold', marginTop: '4px' }}>
                    {receiptCategory === 'car' ? 'ルート証明画像をアップロード済' : '領収書ファイルをアップロード済'}
                  </div>
                  <div style={{ fontSize: '10px', color: '#6B7280' }}>
                    {receiptCategory === 'car' ? 'mock_route_distance.jpg (210 KB)' : 'mock_receipt.jpg (142 KB)'}
                  </div>
                </div>
                {receiptCategory === 'car' && (
                  <div style={{ fontSize: '10px', color: '#B45309', marginTop: '2px', lineHeight: '1.4' }}>
                    ※車移動のガソリン代は、Googleマップ等の移動ルート（距離）がわかるスクリーンショット画像を添付してください。
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>品目 *</label>
                <input 
                  type="text"
                  value={receiptItem}
                  onChange={e => setReceiptItem(e.target.value)}
                  placeholder={
                    receiptCategory === 'transport' ? '例：電車代、タクシー代、新幹線代' :
                    receiptCategory === 'accommodation' ? '例：ホテル宿泊代、カプセルホテル代' : '例：車移動経費'
                  }
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    fontSize: '13px'
                  }}
                />
              </div>

              {receiptCategory === 'transport' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>利用区間（任意）</label>
                  <input 
                    type="text"
                    value={receiptRoute}
                    onChange={e => setReceiptRoute(e.target.value)}
                    placeholder="例：東京駅 〜 品川駅（片道）"
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #ccc',
                      fontSize: '13px'
                    }}
                  />
                </div>
              )}

              {receiptCategory === 'accommodation' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>宿泊施設名（任意）</label>
                    <input 
                      type="text"
                      value={receiptHotelName}
                      onChange={e => setReceiptHotelName(e.target.value)}
                      placeholder="例：〇〇ホテル新宿店"
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ccc',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>宿泊日数（任意）</label>
                    <input 
                      type="text"
                      value={receiptNights}
                      onChange={e => setReceiptNights(e.target.value)}
                      placeholder="例：1泊、2泊など"
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ccc',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                </>
              )}

              {receiptCategory === 'car' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>移動距離 (km) *</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input 
                          type="number"
                          step="0.1"
                          value={receiptDistance === '' ? '' : receiptDistance}
                          onChange={e => setReceiptDistance(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0.0"
                          style={{
                            width: '100%',
                            padding: '8px 30px 8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #ccc',
                            fontSize: '13px'
                          }}
                        />
                        <span style={{ position: 'absolute', right: '10px', fontSize: '11px', color: 'var(--text-sub)' }}>km</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>単価 (円/km) *</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input 
                          type="number"
                          value={receiptGasolineRate}
                          onChange={e => setReceiptGasolineRate(Number(e.target.value))}
                          placeholder="15"
                          style={{
                            width: '100%',
                            padding: '8px 30px 8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #ccc',
                            fontSize: '13px'
                          }}
                        />
                        <span style={{ position: 'absolute', right: '10px', fontSize: '11px', color: 'var(--text-sub)' }}>円</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', padding: '8px 12px', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '12px', color: '#475569' }}>
                    <span>ガソリン代（自動計算）:</span>
                    <span style={{ fontWeight: 'bold', color: '#1E293B' }}>¥{Math.round((Number(receiptDistance) || 0) * (Number(receiptGasolineRate) || 0)).toLocaleString()}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>高速代 (任意)</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <span style={{ position: 'absolute', left: '10px', fontSize: '13px', color: 'var(--text-sub)' }}>¥</span>
                        <input 
                          type="number"
                          className="no-spin"
                          value={receiptExpressway === '' ? '' : receiptExpressway}
                          onChange={e => setReceiptExpressway(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0"
                          style={{
                            width: '100%',
                            padding: '8px 8px 8px 24px',
                            borderRadius: '6px',
                            border: '1px solid #ccc',
                            fontSize: '13px'
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>駐車場代 (任意)</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <span style={{ position: 'absolute', left: '10px', fontSize: '13px', color: 'var(--text-sub)' }}>¥</span>
                        <input 
                          type="number"
                          className="no-spin"
                          value={receiptParking === '' ? '' : receiptParking}
                          onChange={e => setReceiptParking(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0"
                          style={{
                            width: '100%',
                            padding: '8px 8px 8px 24px',
                            borderRadius: '6px',
                            border: '1px solid #ccc',
                            fontSize: '13px'
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>移動経路（任意）</label>
                    <input 
                      type="text"
                      value={receiptRoute}
                      onChange={e => setReceiptRoute(e.target.value)}
                      placeholder="例：自宅 〜 現場"
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ccc',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>備考（任意）</label>
                <textarea 
                  value={receiptNotes}
                  onChange={e => setReceiptNotes(e.target.value)}
                  placeholder="その他経費に関する補足事項など"
                  rows={2}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    fontSize: '12px',
                    resize: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button 
                type="button" 
                onClick={() => setShowReceiptModal(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #E2E8F0',
                  background: 'var(--surface-color)',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                キャンセル
              </button>
              <button 
                type="button" 
                onClick={handleSendReceipt}
                disabled={isReceiptSubmitDisabled}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#10B981',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: !isReceiptSubmitDisabled ? 'pointer' : 'not-allowed',
                  opacity: !isReceiptSubmitDisabled ? 1 : 0.6
                }}
              >
                提出する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手配情報共有モーダル */}
      {showArrangementModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '12px',
            padding: '20px',
            width: '100%',
            maxWidth: '360px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            textAlign: 'left'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ color: '#3B82F6' }}>campaign</span>
              手配情報を共有
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>手配種別 *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {transportArranged && (
                    <button 
                      type="button" 
                      onClick={() => setArrangementCategory('transport')}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '6px',
                        border: arrangementCategory === 'transport' ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                        background: arrangementCategory === 'transport' ? '#EFF6FF' : 'white',
                        color: arrangementCategory === 'transport' ? '#1E40AF' : 'var(--text-main)',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      交通手配
                    </button>
                  )}
                  {accommodationArranged && (
                    <button 
                      type="button" 
                      onClick={() => setArrangementCategory('accommodation')}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '6px',
                        border: arrangementCategory === 'accommodation' ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                        background: arrangementCategory === 'accommodation' ? '#EFF6FF' : 'white',
                        color: arrangementCategory === 'accommodation' ? '#1E40AF' : 'var(--text-main)',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      宿泊手配
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>手配内容・予約情報 *</label>
                <textarea 
                  value={arrangementInfo}
                  onChange={e => setArrangementInfo(e.target.value)}
                  placeholder={
                    arrangementCategory === 'transport' 
                      ? '例：新幹線：東京 10:00発 → 名古屋 11:40着（のぞみ12号 3号車5D）' 
                      : '例：宿泊先：ホテルサンルート徳島、チェックイン：10/14 15:00、予約番号：9982-12'
                  }
                  rows={4}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    fontSize: '12px',
                    resize: 'none',
                    lineHeight: '1.4'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button 
                type="button" 
                onClick={() => setShowArrangementModal(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #E2E8F0',
                  background: 'var(--surface-color)',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                キャンセル
              </button>
              <button 
                type="button" 
                onClick={handleSendArrangement}
                disabled={!arrangementInfo.trim()}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#3B82F6',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: arrangementInfo.trim() ? 'pointer' : 'not-allowed',
                  opacity: arrangementInfo.trim() ? 1 : 0.6
                }}
              >
                共有する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 現場写真送信モーダル */}
      {showPhotoModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--surface-color)',
            borderRadius: '12px',
            padding: '20px',
            width: '100%',
            maxWidth: '360px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            textAlign: 'left'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ color: '#8B5CF6' }}>photo_camera</span>
              現場写真を送信
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>写真を選択（デバイスからアップロード） *</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          setSelectedPhotoUrl(event.target?.result as string);
                          setSelectedPhotoName(file.name);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    style={{ fontSize: '14px', padding: '8px', border: '1px solid #E2E8F0', borderRadius: '6px' }}
                  />
                  {selectedPhotoUrl && (
                    <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', height: '120px', border: '3px solid #8B5CF6' }}>
                      <img src={selectedPhotoUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: '9px', padding: '4px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedPhotoName || 'Preview'}
                      </div>
                    </div>
                  )}
                </div>
               </div>

               <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                 <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>説明・キャプション（任意）</label>
                 <input 
                   type="text" 
                   value={photoCaption}
                   onChange={e => setPhotoCaption(e.target.value)}
                   placeholder="例：現在の現場の混雑状況です。"
                   style={{
                     padding: '8px 12px',
                     borderRadius: '6px',
                     border: '1px solid #ccc',
                     fontSize: '13px'
                   }}
                 />
               </div>
             </div>

             <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
               <button 
                 type="button" 
                 onClick={() => setShowPhotoModal(false)}
                 style={{
                   flex: 1,
                   padding: '10px',
                   borderRadius: '6px',
                   border: '1px solid #E2E8F0',
                   background: 'var(--surface-color)',
                   fontSize: '13px',
                   fontWeight: 'bold',
                   cursor: 'pointer'
                 }}
               >
                 キャンセル
               </button>
               <button 
                 type="button" 
                 onClick={handleSendPhoto}
                 disabled={!selectedPhotoUrl}
                 style={{
                   flex: 1,
                   padding: '10px',
                   borderRadius: '6px',
                   border: 'none',
                   background: '#8B5CF6',
                   color: 'white',
                   fontSize: '13px',
                   fontWeight: 'bold',
                   cursor: selectedPhotoUrl ? 'pointer' : 'not-allowed',
                   opacity: selectedPhotoUrl ? 1 : 0.6
                 }}
               >
                 送信する
               </button>
             </div>
           </div>
         </div>
       )}


        {/* 領収書一覧・承認モーダル */}
        {showReceiptsListModal && activeChat && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}>
            <div style={{
              background: 'var(--surface-color)',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '480px',
              maxHeight: '85vh',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #E2E8F0', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: '#10B981' }}>receipt_long</span>
                  領収書一覧・承認
                </h3>
                <button 
                  onClick={() => setShowReceiptsListModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9CA3AF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px',
                    borderRadius: '50%'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F3F4F6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                {messages.filter((m: any) => m.isReceipt).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9CA3AF' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#E5E7EB', marginBottom: '8px' }}>receipt_long</span>
                    <p style={{ margin: 0, fontSize: '14px' }}>提出済みの領収書はありません。</p>
                  </div>
                ) : (
                  messages.filter((m: any) => m.isReceipt).map((msg: any) => {
                    const isApproved = msg.receiptDetails?.status === 'approved';
                    const category = msg.receiptDetails?.category || 'transport';
                    const categoryLabel = getExpenseCategoryLabel(category);
                    const amount = msg.receiptDetails?.amount || 0;
                    const item = msg.receiptDetails?.item || '未指定';
                    const route = msg.receiptDetails?.route || '';
                    const notes = msg.receiptDetails?.notes || '';
                    const hotelName = msg.receiptDetails?.hotelName || '';
                    const nights = msg.receiptDetails?.nights || '';
                    const distance = msg.receiptDetails?.distance;
                    const gasolineRate = msg.receiptDetails?.gasolineRate;
                    const gasoline = msg.receiptDetails?.gasoline;
                    const expressway = msg.receiptDetails?.expressway;
                    const parking = msg.receiptDetails?.parking;
                    
                    return (
                      <div key={msg.id} style={{
                        border: isApproved ? '1px solid #A7F3D0' : '1px solid #FDE68A',
                        borderRadius: '12px',
                        padding: '14px',
                        background: isApproved ? '#F0FDF4' : '#FFFBEB',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 'bold',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: category === 'transport' ? '#D1FAE5' : category === 'accommodation' ? '#DBEAFE' : '#F3E8FF',
                            color: category === 'transport' ? '#065F46' : category === 'accommodation' ? '#1E40AF' : '#6B21A8'
                          }}>
                            {categoryLabel}
                          </span>
                          
                          <span style={{ 
                            fontSize: '11px', 
                            fontWeight: 'bold', 
                            padding: '2px 8px', 
                            borderRadius: '12px',
                            background: isApproved ? '#DEF7EC' : '#FEF3C7',
                            color: isApproved ? '#03543F' : '#D97706',
                            whiteSpace: 'nowrap'
                          }}>
                            {isApproved ? '精算完了' : '承認待ち'}
                          </span>
                        </div>
 
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px dashed #E2E8F0', paddingBottom: '6px' }}>
                          <span style={{ fontSize: '13px', color: '#4B5563' }}>品目: <strong style={{ color: '#111827' }}>{item}</strong></span>
                          <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>¥{amount.toLocaleString()}</span>
                        </div>
 
                        {category === 'accommodation' && hotelName && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', gap: '4px' }}>
                            <span style={{ color: '#9CA3AF', flexShrink: 0 }}>宿泊先:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>{hotelName}</span>
                          </div>
                        )}
                        {category === 'accommodation' && nights && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#9CA3AF' }}>宿泊日数:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>{nights} 泊</span>
                          </div>
                        )}
 
                        {category === 'car' && distance !== undefined && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#9CA3AF' }}>移動距離:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>{distance} km</span>
                          </div>
                        )}
                        {category === 'car' && gasolineRate !== undefined && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#9CA3AF' }}>ガソリン単価:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>{gasolineRate} 円/km</span>
                          </div>
                        )}
                        {category === 'car' && gasoline !== undefined && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#9CA3AF' }}>ガソリン代:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>¥{gasoline.toLocaleString()}</span>
                          </div>
                        )}
                        {category === 'car' && expressway !== undefined && expressway > 0 && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#9CA3AF' }}>高速代:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>¥{expressway.toLocaleString()}</span>
                          </div>
                        )}
                        {category === 'car' && parking !== undefined && parking > 0 && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#9CA3AF' }}>駐車場代:</span>
                            <span style={{ color: '#1F2937', fontWeight: 'bold' }}>¥{parking.toLocaleString()}</span>
                          </div>
                        )}
 
                        {route && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', gap: '4px' }}>
                            <span style={{ color: '#9CA3AF', flexShrink: 0 }}>{category === 'car' ? '移動ルート:' : '利用区間:'}</span>
                            <span style={{ color: '#1F2937' }}>{route}</span>
                          </div>
                        )}
 
                        {notes && (
                          <div style={{ fontSize: '12px', color: '#4B5563', display: 'flex', gap: '4px' }}>
                            <span style={{ color: '#9CA3AF', flexShrink: 0 }}>備考:</span>
                            <span style={{ color: '#1F2937', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{notes}</span>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #E5E7EB', fontSize: '11px', color: '#9CA3AF' }}>
                          <span>申請日時: {msg.time}</span>
                          {msg.senderName && <span>申請者: {msg.senderName.split('_')[0]}</span>}
                        </div>

                        {!isApproved && isClient && (
                          <button
                            onClick={() => handleApproveReceipt(msg.id)}
                            style={{
                              marginTop: '8px',
                              background: '#10B981',
                              color: '#FFFFFF',
                              border: 'none',
                              fontSize: '12px',
                              padding: '8px 16px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                            この領収書を承認する
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ display: 'flex', marginTop: '8px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowReceiptsListModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {showEditConditionsModal && relatedJob && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            padding: '16px'
          }}>
            <div style={{
              background: 'var(--surface-color)',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #E2E8F0', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>edit_note</span>
                  契約条件の編集
                </h3>
                <button 
                  onClick={() => setShowEditConditionsModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9CA3AF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px',
                    borderRadius: '50%'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F3F4F6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
                {/* 日当単価編集 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>日当単価 (円) *</label>
                  <input 
                    type="number"
                    className="no-spin"
                    value={editConditionsPrice || ''}
                    onChange={(e) => setEditConditionsPrice(Number(e.target.value))}
                    onWheel={(e) => e.currentTarget.blur()}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                      width: '100%'
                    }}
                  />
                </div>

                {/* 稼働日編集 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>稼働日程 *</label>
                  <input 
                    type="text"
                    value={editConditionsDate}
                    onChange={(e) => setEditConditionsDate(e.target.value)}
                    placeholder="例: 10/14 - 10/15 (2日間)"
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                      width: '100%'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowEditConditionsModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  キャンセル
                </button>
                <button 
                  type="button" 
                  onClick={handleSaveConditions}
                  disabled={!editConditionsPrice || editConditionsPrice <= 0 || !editConditionsDate.trim()}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: (!editConditionsPrice || editConditionsPrice <= 0 || !editConditionsDate.trim()) ? '#CBD5E1' : 'var(--primary)',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: (!editConditionsPrice || editConditionsPrice <= 0 || !editConditionsDate.trim()) ? 'not-allowed' : 'pointer',
                    boxShadow: (!editConditionsPrice || editConditionsPrice <= 0 || !editConditionsDate.trim()) ? 'none' : '0 4px 6px -1px rgba(99, 102, 241, 0.2)'
                  }}
                >
                  変更を保存
                </button>
              </div>
            </div>
          </div>
        )}
     </div>
   );
 }
