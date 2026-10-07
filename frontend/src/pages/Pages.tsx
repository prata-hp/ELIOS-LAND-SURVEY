
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, Archive, ArrowRight, BarChart3, Bell, CheckCircle2, ChevronDown,
  CircleHelp, Cloud, CloudUpload, Database, FileArchive, FileImage, FolderOpen,
  Gauge, Layers3, LayoutDashboard, Map, MapPinned, Menu, MoreHorizontal,
  PackageCheck, Play, Plus, RefreshCw, Satellite, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, UploadCloud, UserRound, X, Zap, type LucideIcon
} from 'lucide-react'
import { getSurveys, createSurvey } from '../api/surveys'
import {
  getSurveyFiles,
  uploadSurveyFiles,
  validateSurveyData,
  type SurveyFile,
} from '../api/uploads'
import type { Survey } from '../api/surveys'
import {
  getProcessingJobs,
  startOrthomosaic,
} from '../api/processing'
import type { ProcessingJob } from '../api/processing'
import { getArtifacts } from '../api/orthomosaic'
import type { ProcessingArtifact } from '../api/orthomosaic'
import { getCadastralVerificationCases } from '../api/verification'
import CadastralComparisonLive from '../components/CadastralComparisonLive'
import GISWorkspace from '../components/GISWorkspace'

type NavKey = 'overview' | 'projects' | 'survey' | 'upload' | 'processing' | 'orthomosaic' | 'quality' | 'boundary' | 'comparison' | 'verification' | 'evidence'

const nav: { key: NavKey; label: string; icon: any; group?: string }[] = [
  { key: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'projects', label: 'Survey Projects', icon: MapPinned, group: 'OPERATIONS' },
  { key: 'upload', label: 'Data Upload', icon: CloudUpload },
  { key: 'processing', label: 'Processing', icon: Activity },
  { key: 'orthomosaic', label: 'Orthomosaic Workspace', icon: Map },
  { key: 'quality', label: 'Survey Quality', icon: Gauge },
  { key: 'boundary', label: 'Boundary Extraction', icon: Layers3 },
  { key: 'comparison', label: 'Cadastral Comparison', icon: BarChart3 },
  { key: 'verification', label: 'Verification Cases', icon: ShieldCheck },
  { key: 'evidence', label: 'Evidence & Reports', icon: Archive },
]

const futureMapLayers = [
  'Orthomosaic', 'Cadastral boundary', 'Observed boundary', 'GCP', 'Checkpoints', 'Displacement'
]

function App() {
  const [active, setActive] = useState<NavKey>('overview')
  const [sidebar, setSidebar] = useState(true)
  const [notice, setNotice] = useState('')
  const [processing, setProcessing] = useState(false)
  const [selectedLayer, setSelectedLayer] = useState('Orthomosaic')
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null)

  const title = useMemo(() => nav.find(n => n.key === active)?.label ?? 'Dashboard', [active])

  const toast = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const runMockProcessing = () => {
    setProcessing(true)
    toast('Frontend demo: processing job queued')
    window.setTimeout(() => {
      setProcessing(false)
      toast('Frontend demo: processing stage completed')
    }, 1800)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? '' : 'collapsed'}`}>
        <div className="brand">
          <div className="brand-mark">E</div>
          {sidebar && <div><strong>ELIOS-LAND</strong><span>Survey intelligence</span></div>}
        </div>

        <button className="collapse-btn" onClick={() => setSidebar(!sidebar)} title="Toggle navigation">
          <Menu size={18} />
        </button>

        <div className="nav-scroll">
          <div className="nav-section-label">{sidebar ? 'PLATFORM' : '•'}</div>
          {nav.map(item => {
            const Icon = item.icon
            return (
              <div key={item.key}>
                {item.group && sidebar && <div className="nav-section-label">{item.group}</div>}
                <button
                  className={`nav-item ${active === item.key ? 'active' : ''}`}
                  onClick={() => setActive(item.key)}
                  title={item.label}
                >
                  <Icon size={17} />
                  {sidebar && <span>{item.label}</span>}
                </button>
              </div>
            )
          })}
        </div>

        {sidebar && (
          <div className="sidebar-footer">
            <div className="env-chip"><span className="dot green" /> Frontend prototype</div>
            <button className="nav-item"><Settings size={17}/><span>Settings</span></button>
            <button className="user-card"><div className="avatar">S</div><div><b>Survey Operator</b><span>Prototype workspace</span></div><MoreHorizontal size={16}/></button>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="crumb">ELIOS-LAND <span>/</span> {title}</div>
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={() => toast('No backend notifications connected yet')}><Bell size={18}/></button>
            <button className="icon-btn" onClick={() => toast('Help center will be connected later')}><CircleHelp size={18}/></button>
            <div className="top-user">S</div>
          </div>
        </header>

        <section className="content">
          {active === 'overview' && (
            <Dashboard
              onNavigate={setActive}
              toast={toast}
              selectedSurvey={selectedSurvey}
              onSelectSurvey={setSelectedSurvey}
            />
          )}
          {active === 'projects' && (
            <Projects
              onNavigate={setActive}
              onSelectSurvey={(survey) => {
                setSelectedSurvey(survey)
                setActive('survey')
              }}
            />
          )}
          {active === 'survey' && selectedSurvey && (
            <SurveyWorkspace
              survey={selectedSurvey}
              onNavigate={setActive}
            />
          )}
          {active === 'upload' && selectedSurvey && (
            <UploadPage
              survey={selectedSurvey}
              toast={toast}
            />
          )}
          {active === 'processing' && selectedSurvey && (
            <ProcessingPage survey={selectedSurvey} />
          )}
          {active === 'orthomosaic' && (
            <GISWorkspace
              surveyId={selectedSurvey?.id}
            />
          )}
          {active === 'quality' && <QualityPage />}
          {active === 'boundary' && <BoundaryPage toast={toast} />}
          {active === 'comparison' && <CadastralComparisonLive />}
          {active === 'verification' && <VerificationPage />}
          {active === 'evidence' && <EvidencePage toast={toast} />}
        </section>
      </main>

      {notice && <div className="toast"><CheckCircle2 size={17}/>{notice}</div>}
    </div>
  )
}

function PageHead({eyebrow, title, subtitle, action}: {eyebrow: string; title: string; subtitle: string; action?: React.ReactNode}) {
  return <div className="page-head">
    <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>
    {action}
  </div>
}

function Dashboard({
  onNavigate,
  toast,
  selectedSurvey,
  onSelectSurvey,
}: {
  onNavigate: (n: NavKey) => void
  toast: (s: string) => void
  selectedSurvey: Survey | null
  onSelectSurvey: (survey: Survey) => void
}) {
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [files, setFiles] = useState<SurveyFile[]>([])
  const [jobs, setJobs] = useState<ProcessingJob[]>([])
  const [artifacts, setArtifacts] = useState<ProcessingArtifact[]>([])
  const [verificationCases, setVerificationCases] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    async function loadData() {
      try {
        const [surveysRes, verificationRes] = await Promise.all([
          getSurveys().catch(() => []),
          getCadastralVerificationCases().catch(() => ({ cases: [] as any[] })),
        ])

        if (!isMounted) return

        const loadedSurveys = Array.isArray(surveysRes) ? surveysRes : []
        setSurveys(loadedSurveys)

        const loadedCases = Array.isArray(verificationRes)
          ? verificationRes
          : ((verificationRes as any)?.cases || [])
        setVerificationCases(loadedCases)

        if (!selectedSurvey && loadedSurveys.length > 0) {
          onSelectSurvey(loadedSurveys[0])
        }
      } catch (err) {
        console.error('Failed to load overview data:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    loadData()
    return () => { isMounted = false }
  }, [])

  const currentSurvey = selectedSurvey || (surveys.length > 0 ? surveys[0] : null)

  useEffect(() => {
    if (!currentSurvey?.id) {
      setFiles([])
      setJobs([])
      setArtifacts([])
      return
    }

    const targetSurveyId = currentSurvey.id
    let isMounted = true
    async function loadSurveyDetails() {
      try {
        const [filesRes, jobsRes, artifactsRes] = await Promise.all([
          getSurveyFiles(targetSurveyId).catch(() => []),
          getProcessingJobs(targetSurveyId).catch(() => []),
          getArtifacts(targetSurveyId).catch(() => []),
        ])

        if (!isMounted) return
        setFiles(Array.isArray(filesRes) ? filesRes : [])
        setJobs(Array.isArray(jobsRes) ? jobsRes : [])
        setArtifacts(Array.isArray(artifactsRes) ? artifactsRes : [])
      } catch (err) {
        console.error('Failed to load survey details:', err)
      }
    }
    loadSurveyDetails()
    return () => { isMounted = false }
  }, [currentSurvey?.id])

  // Metric 1: Active surveys
  const activeSurveysCount = surveys.length
  const activeSurveysValue = activeSurveysCount > 0 ? String(activeSurveysCount) : '0'
  const activeSurveysNote = activeSurveysCount > 0
    ? (activeSurveysCount === 1 ? '1 active survey' : `${activeSurveysCount} active surveys`)
    : 'No active survey'

  // Metric 2: Processing jobs
  const processingJobsCount = jobs.length
  const activeJobsCount = jobs.filter(j => j.status === 'RUNNING' || j.status === 'QUEUED').length
  const processingJobsValue = processingJobsCount > 0 ? String(processingJobsCount) : '0'
  const processingJobsNote = processingJobsCount > 0
    ? (activeJobsCount > 0 ? `${activeJobsCount} running` : 'Job queue')
    : 'Not started'

  // Metric 3: Orthomosaics ready
  const orthoArtifacts = artifacts.filter(a => a.artifact_type === 'ORTHOMOSAIC' || a.artifact_type === 'ORTHOMOSAIC_ORIGINAL')
  const orthomosaicsCount = orthoArtifacts.length
  const orthomosaicsValue = orthomosaicsCount > 0 ? String(orthomosaicsCount) : '0'
  const orthomosaicsNote = orthomosaicsCount > 0 ? 'Raster outputs ready' : 'Not started'

  // Metric 4: Pending verification
  const pendingCases = verificationCases.filter(c => c.status !== 'RESOLVED' && c.status !== 'CLOSED')
  const pendingVerificationCount = verificationCases.length > 0 ? pendingCases.length : 0
  const pendingVerificationValue = verificationCases.length > 0 ? String(pendingVerificationCount) : '0'
  const pendingVerificationNote = verificationCases.length > 0
    ? (pendingVerificationCount === 1 ? '1 open case' : `${pendingVerificationCount} open cases`)
    : 'Not started'

  const cards: [string, string, string, LucideIcon][] = [
    ['Active surveys', activeSurveysValue, activeSurveysNote, MapPinned],
    ['Processing jobs', processingJobsValue, processingJobsNote, Activity],
    ['Orthomosaics ready', orthomosaicsValue, orthomosaicsNote, Map],
    ['Pending verification', pendingVerificationValue, pendingVerificationNote, ShieldCheck]
  ]

  // Workflow 10 stages computation
  const stages = useMemo(() => {
    if (!currentSurvey) {
      return [
        { id: 'cadastral', num: '01', name: 'Cadastral', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'comparison' as NavKey },
        { id: 'mission', num: '02', name: 'Mission', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'projects' as NavKey },
        { id: 'upload', num: '03', name: 'Data Upload', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'upload' as NavKey },
        { id: 'ppk', num: '04', name: 'PPK / GNSS', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'processing' as NavKey },
        { id: 'photogrammetry', num: '05', name: 'Photogrammetry', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'processing' as NavKey },
        { id: 'orthomosaic', num: '06', name: 'Orthomosaic', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'orthomosaic' as NavKey },
        { id: 'boundary', num: '07', name: 'Boundary', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'boundary' as NavKey },
        { id: 'comparison', num: '08', name: 'Comparison', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'comparison' as NavKey },
        { id: 'verification', num: '09', name: 'Verification', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'verification' as NavKey },
        { id: 'evidence', num: '10', name: 'Evidence / Report', status: 'NOT_STARTED', summary: 'No active survey', navKey: 'evidence' as NavKey },
      ]
    }

    const imageCount = files.filter(f => f.file_type === 'IMAGE').length
    const gnssCount = files.filter(f => f.file_type === 'RINEX' || f.file_type.includes('GCP')).length

    const ppkJob = jobs.find(j => j.job_type === 'PPK')
    const orthoJob = jobs.find(j => j.job_type === 'ORTHOMOSAIC')

    const orthoArtifact = artifacts.find(a => a.artifact_type === 'ORTHOMOSAIC' || a.artifact_type === 'ORTHOMOSAIC_ORIGINAL')
    const boundaryArtifact = artifacts.find(a => a.artifact_type === 'BOUNDARY' || a.artifact_type === 'BOUNDARY_GEOJSON')

    // Stage 01 Cadastral
    let cadastralStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let cadastralSummary = 'No parcel linked'
    if (currentSurvey.parcel_id) {
      cadastralStatus = 'COMPLETED'
      cadastralSummary = `Parcel: ${currentSurvey.parcel_id}`
    }

    // Stage 02 Mission
    const missionStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'COMPLETED'
    const missionSummary = `Code: ${currentSurvey.survey_code}`

    // Stage 03 Data Upload
    let uploadStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let uploadSummary = '0 files uploaded'
    if (files.length > 0) {
      uploadStatus = 'COMPLETED'
      uploadSummary = `${files.length} file${files.length === 1 ? '' : 's'} (${imageCount} img${gnssCount ? `, ${gnssCount} GNSS` : ''})`
    }

    let ppkStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let ppkSummary = 'No PPK data'
    if (ppkJob?.status === 'COMPLETED') {
      ppkStatus = 'COMPLETED'
      ppkSummary = 'PPK positioning complete'
    } else if (ppkJob?.status === 'RUNNING' || ppkJob?.status === 'QUEUED') {
      ppkStatus = 'IN_PROGRESS'
      ppkSummary = `PPK processing ${ppkJob.progress}%`
    } else if (gnssCount > 0) {
      ppkStatus = 'READY'
      ppkSummary = `${gnssCount} GNSS/GCP file(s) ready`
    }

    // Stage 05 Photogrammetry
    let photoStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let photoSummary = 'Awaiting imagery'
    if (orthoJob?.status === 'COMPLETED') {
      photoStatus = 'COMPLETED'
      photoSummary = 'Reconstruction complete'
    } else if (orthoJob?.status === 'RUNNING' || orthoJob?.status === 'QUEUED') {
      photoStatus = 'IN_PROGRESS'
      photoSummary = `Processing ${orthoJob.progress}%`
    } else if (imageCount > 0) {
      photoStatus = 'READY'
      photoSummary = `${imageCount} image(s) ready`
    }

    // Stage 06 Orthomosaic
    let orthoStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let orthoSummary = 'No raster output'
    if (orthoArtifact) {
      orthoStatus = 'COMPLETED'
      const mb = (orthoArtifact.size_bytes / (1024 * 1024)).toFixed(1)
      orthoSummary = `${mb} MB GeoTIFF ready`
    } else if (orthoJob?.status === 'RUNNING' || orthoJob?.status === 'QUEUED') {
      orthoStatus = 'IN_PROGRESS'
      orthoSummary = 'Generating raster output...'
    }

    // Stage 07 Boundary
    let boundaryStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let boundarySummary = 'Orthomosaic required'
    if (boundaryArtifact) {
      boundaryStatus = 'COMPLETED'
      boundarySummary = 'Boundary extracted'
    } else if (orthoArtifact) {
      boundaryStatus = 'READY'
      boundarySummary = 'Ready for extraction'
    }

    // Stage 08 Comparison
    let compareStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let compareSummary = 'Awaiting boundary & parcel'
    if (boundaryArtifact && currentSurvey.parcel_id) {
      compareStatus = 'COMPLETED'
      compareSummary = 'Geometry compared'
    } else if (boundaryArtifact || currentSurvey.parcel_id) {
      compareStatus = 'READY'
      compareSummary = 'Ready for comparison'
    }

    // Stage 09 Verification
    let verifyStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let verifySummary = 'Awaiting comparison'
    if (verificationCases.length > 0) {
      const openCases = verificationCases.filter(c => c.status !== 'RESOLVED' && c.status !== 'CLOSED').length
      if (openCases === 0) {
        verifyStatus = 'COMPLETED'
        verifySummary = `${verificationCases.length} case(s) verified`
      } else {
        verifyStatus = 'IN_PROGRESS'
        verifySummary = `${openCases} pending case(s)`
      }
    } else if (compareStatus === 'COMPLETED' || boundaryArtifact) {
      verifyStatus = 'READY'
      verifySummary = 'No pending anomalies'
    }

    // Stage 10 Evidence / Report
    let evidenceStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' = 'NOT_STARTED'
    let evidenceSummary = 'Not generated'
    if (compareStatus === 'COMPLETED' || verifyStatus === 'COMPLETED') {
      evidenceStatus = 'COMPLETED'
      evidenceSummary = 'Evidence package ready'
    } else if (orthoStatus === 'COMPLETED') {
      evidenceStatus = 'READY'
      evidenceSummary = 'Ready to package'
    }

    return [
      { id: 'cadastral', num: '01', name: 'Cadastral', status: cadastralStatus, summary: cadastralSummary, navKey: 'comparison' as NavKey },
      { id: 'mission', num: '02', name: 'Mission', status: missionStatus, summary: missionSummary, navKey: 'projects' as NavKey },
      { id: 'upload', num: '03', name: 'Data Upload', status: uploadStatus, summary: uploadSummary, navKey: 'upload' as NavKey },
      { id: 'ppk', num: '04', name: 'PPK / GNSS', status: ppkStatus, summary: ppkSummary, navKey: 'processing' as NavKey },
      { id: 'photogrammetry', num: '05', name: 'Photogrammetry', status: photoStatus, summary: photoSummary, navKey: 'processing' as NavKey },
      { id: 'orthomosaic', num: '06', name: 'Orthomosaic', status: orthoStatus, summary: orthoSummary, navKey: 'orthomosaic' as NavKey },
      { id: 'boundary', num: '07', name: 'Boundary', status: boundaryStatus, summary: boundarySummary, navKey: 'boundary' as NavKey },
      { id: 'comparison', num: '08', name: 'Comparison', status: compareStatus, summary: compareSummary, navKey: 'comparison' as NavKey },
      { id: 'verification', num: '09', name: 'Verification', status: verifyStatus, summary: verifySummary, navKey: 'verification' as NavKey },
      { id: 'evidence', num: '10', name: 'Evidence / Report', status: evidenceStatus, summary: evidenceSummary, navKey: 'evidence' as NavKey },
    ]
  }, [currentSurvey, files, jobs, artifacts, verificationCases])

  const completedStagesCount = useMemo(() => stages.filter(s => s.status === 'COMPLETED').length, [stages])
  const overallProgressPercent = useMemo(() => {
    let score = 0
    stages.forEach(s => {
      if (s.status === 'COMPLETED') score += 10
      else if (s.status === 'IN_PROGRESS' || s.status === 'READY') score += 5
    })
    return Math.min(100, Math.round(score))
  }, [stages])

  const nextActionStage = useMemo(() => stages.find(s => s.status !== 'COMPLETED') || null, [stages])

  const handleStageNavigate = (targetKey: NavKey) => {
    if (!selectedSurvey && surveys.length > 0) {
      onSelectSurvey(surveys[0])
    }
    onNavigate(targetKey)
  }

  return (
    <div>
      <PageHead
        eyebrow="OPERATIONS OVERVIEW"
        title="Survey intelligence workspace"
        subtitle={currentSurvey ? `Active survey project: ${currentSurvey.name} (${currentSurvey.survey_code})` : 'Select or create a survey project to begin.'}
        action={
          <button className="btn primary" onClick={() => onNavigate('projects')}>
            <Plus size={17} /> New survey
          </button>
        }
      />

      <div className="stat-grid">
        {cards.map(([label, value, note, Icon]) => (
          <div className="stat-card" key={label}>
            <div className="stat-icon">
              <Icon size={18} />
            </div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <b>Survey workflow</b>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '10px', color: '#8494a6' }}>
                Progress: <strong style={{ color: '#38bdf8' }}>{completedStagesCount}/10</strong> ({overallProgressPercent}%)
              </span>
              <div style={{ width: '70px', height: '6px', background: '#152331', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${overallProgressPercent}%`, height: '100%', background: '#2563eb', transition: 'width 0.3s' }} />
              </div>
            </div>
          </div>
          <div style={{ padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {stages.map((stg) => (
              <div
                key={stg.id}
                onClick={() => handleStageNavigate(stg.navKey)}
                style={{
                  background: '#0d1824',
                  border: '1px solid #1c2b3c',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '74px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#38bdf8'
                  e.currentTarget.style.background = '#102030'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#1c2b3c'
                  e.currentTarget.style.background = '#0d1824'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span className="mono" style={{ fontSize: '11px', color: '#5fa5f4', fontWeight: 'bold' }}>
                    {stg.num}
                  </span>
                  <span className={`status-pill ${stg.status.toLowerCase()}`}>
                    {stg.status.replace('_', ' ')}
                  </span>
                </div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#f5f8fb' }}>
                  {stg.name}
                </div>
                <div style={{ fontSize: '9px', color: '#6f8295', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stg.summary}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <b>Next action</b>
              <span>Recommended workflow step</span>
            </div>
            <Zap size={17} style={{ color: '#3b82f6' }} />
          </div>
          <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '340px' }}>
            {nextActionStage ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <span className="mono" style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 'bold' }}>
                    STAGE {nextActionStage.num}
                  </span>
                  <span className={`status-pill ${nextActionStage.status.toLowerCase()}`}>
                    {nextActionStage.status.replace('_', ' ')}
                  </span>
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: '#f5f8fb' }}>
                  {nextActionStage.name}
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '11px', color: '#8494a6', lineHeight: '1.5' }}>
                  {nextActionStage.summary}
                </p>
                <div style={{ background: '#09131e', border: '1px solid #1a2d3e', borderRadius: '6px', padding: '12px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '9px', color: '#52718e', letterSpacing: '.08em', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
                    INCOMPLETE STAGE IDENTIFIED
                  </span>
                  <span style={{ fontSize: '11px', color: '#c4d2df' }}>
                    Click below to open stage navigation and proceed with {nextActionStage.name.toLowerCase()}.
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <CheckCircle2 size={20} style={{ color: '#22c55e' }} />
                  <span className="status-pill completed">COMPLETED</span>
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: '17px', color: '#f5f8fb' }}>
                  All survey stages completed
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '11px', color: '#8494a6', lineHeight: '1.5' }}>
                  All 10 workflow stages have been completed for this survey project.
                </p>
              </div>
            )}

            <button
              className="btn primary"
              style={{ width: '100%', justifyContent: 'center', padding: '10px 14px' }}
              onClick={() => handleStageNavigate(nextActionStage ? nextActionStage.navKey : 'evidence')}
            >
              {nextActionStage ? `Open ${nextActionStage.name}` : 'View Evidence & Report'} <ArrowRight size={15} />
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <b>Integration boundary</b>
            <span>Connected backend services & API modules</span>
          </div>
          <button className="btn secondary" onClick={() => toast('API contracts active with FastAPI backend')}>
            API contracts
          </button>
        </div>
        <div className="integration-grid">
          <Integration icon={<Database />} title="Cadastral API" text="Parcels, land records, source geometry, CRS and identifiers." />
          <Integration icon={<Satellite />} title="Survey ingestion" text="Images, image GPS, RINEX, GCP, checkpoints and flight logs." />
          <Integration icon={<Zap />} title="Processing jobs" text="PPK, ODM, raster generation, quality metrics and job progress." />
          <Integration icon={<Sparkles />} title="Analysis API" text="Observed boundary, comparison, uncertainty and verification cases." />
        </div>
      </section>
    </div>
  )
}

function Integration({icon,title,text}:{icon:React.ReactNode;title:string;text:string}) {
  return <div className="integration"><div className="integration-icon">{icon}</div><div><b>{title}</b><p>{text}</p></div></div>
}

function Projects({
  onNavigate,
  onSelectSurvey,
}: {
  onNavigate: (n: NavKey) => void
  onSelectSurvey: (survey: Survey) => void
}) {
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)

  const [surveyCode, setSurveyCode] = useState('')
  const [surveyName, setSurveyName] = useState('')
  const [parcelId, setParcelId] = useState('')
  const [description, setDescription] = useState('')

  const loadSurveys = () => {
    setLoading(true)
    setError('')

    getSurveys()
      .then(data => setSurveys(data))
      .catch(err => {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load survey projects'
        )
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadSurveys()
  }, [])

  const resetForm = () => {
    setSurveyCode('')
    setSurveyName('')
    setParcelId('')
    setDescription('')
  }

  const handleCreateSurvey = async () => {
    const code = surveyCode.trim()
    const name = surveyName.trim()

    if (!code || !name) {
      setError('Survey code and survey name are required.')
      return
    }

    setCreating(true)
    setError('')

    try {
      const survey = await createSurvey({
        survey_code: code,
        name,
        parcel_id: parcelId.trim() || null,
        description: description.trim() || null,
      })

      setShowCreate(false)
      resetForm()

      setSurveys(current => [
        survey,
        ...current.filter(item => item.id !== survey.id),
      ])

      onSelectSurvey(survey)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to create survey'
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <PageHead
        eyebrow="PROJECTS"
        title="Survey projects"
        subtitle="Central object linking parcel, mission, data, processing and verification."
        action={
          <button
            className="btn primary"
            onClick={() => {
              setError('')
              setShowCreate(true)
            }}
          >
            <Plus size={17}/>
            Create survey
          </button>
        }
      />

      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <b>Project registry</b>
            <span>
              {loading
                ? 'Loading from backend'
                : `${surveys.length} survey${surveys.length === 1 ? '' : 's'} loaded`}
            </span>
          </div>

          <button
            className="icon-btn"
            onClick={loadSurveys}
            disabled={loading}
            title="Refresh surveys"
          >
            <RefreshCw
              className={loading ? 'spin' : ''}
              size={17}
            />
          </button>
        </div>

        {loading && (
          <div className="empty">
            <RefreshCw className="spin" size={30}/>
            <b>Loading survey projects</b>
            <p>Connecting to the ELIOS-LAND backend.</p>
          </div>
        )}

        {!loading && error && !showCreate && (
          <div className="empty">
            <X size={30}/>
            <b>Unable to load survey projects</b>
            <p>{error}</p>
            <button
              className="btn secondary"
              onClick={loadSurveys}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && surveys.length === 0 && (
          <div className="empty">
            <MapPinned size={34}/>
            <b>No survey projects found</b>
            <p>The backend currently has no survey projects.</p>

            <button
              className="btn primary"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16}/>
              Create first survey
            </button>
          </div>
        )}

        {!loading && surveys.length > 0 && (
          <div className="survey-table">
            {surveys.map(survey => (
              <button
                className="survey-row"
                key={survey.id}
                onClick={() => onSelectSurvey(survey)}
              >
                <div>
                  <b>{survey.survey_code}</b>
                  <span>{survey.name}</span>
                </div>

                <div>
                  <span className="mono">
                    {survey.parcel_id ?? 'No parcel'}
                  </span>
                </div>

                <div>
                  <span
                    className={
                      survey.status === 'READY'
                        ? 'status-ok'
                        : 'status-pending'
                    }
                  >
                    {survey.status}
                  </span>
                </div>

                <ArrowRight size={16}/>
              </button>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!creating) {
              setShowCreate(false)
              setError('')
            }
          }}
        >
          <div
            className="modal create-survey-modal"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <b>Create survey project</b>
                <span>Register a new ELIOS-LAND survey</span>
              </div>

              <button
                className="icon-btn"
                disabled={creating}
                onClick={() => {
                  setShowCreate(false)
                  setError('')
                }}
              >
                <X size={18}/>
              </button>
            </div>

            <div className="create-survey-form">
              {error && (
                <div className="form-error">
                  <X size={14}/>
                  <span>{error}</span>
                </div>
              )}

              <label>
                <span>Survey Code *</span>
                <input
                  value={surveyCode}
                  onChange={event =>
                    setSurveyCode(event.target.value)
                  }
                  placeholder="e.g. SUR-000002"
                  disabled={creating}
                  autoFocus
                />
              </label>

              <label>
                <span>Survey Name *</span>
                <input
                  value={surveyName}
                  onChange={event =>
                    setSurveyName(event.target.value)
                  }
                  placeholder="e.g. Village Parcel Survey"
                  disabled={creating}
                />
              </label>

              <label>
                <span>Parcel Reference</span>
                <input
                  value={parcelId}
                  onChange={event =>
                    setParcelId(event.target.value)
                  }
                  placeholder="e.g. PARCEL-000002"
                  disabled={creating}
                />
              </label>

              <label>
                <span>Description</span>
                <textarea
                  value={description}
                  onChange={event =>
                    setDescription(event.target.value)
                  }
                  placeholder="Describe the survey project..."
                  rows={4}
                  disabled={creating}
                />
              </label>
            </div>

            <div className="modal-foot">
              <span>
                New surveys start in DRAFT status.
              </span>

              <div className="form-actions">
                <button
                  className="btn secondary"
                  disabled={creating}
                  onClick={() => {
                    setShowCreate(false)
                    setError('')
                  }}
                >
                  Cancel
                </button>

                <button
                  className="btn primary"
                  disabled={creating}
                  onClick={handleCreateSurvey}
                >
                  {creating ? (
                    <>
                      <RefreshCw className="spin" size={15}/>
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus size={15}/>
                      Create survey
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SurveyWorkspace({
  survey,
  onNavigate,
}: {
  survey: Survey
  onNavigate: (n: NavKey) => void
}) {
  return (
    <div>
      <PageHead
        eyebrow="SURVEY WORKSPACE"
        title={survey.name}
        subtitle={`${survey.survey_code} · Central survey workspace`}
        action={
          <button
            className="btn secondary"
            onClick={() => onNavigate('projects')}
          >
            <ArrowRight size={16}/>
            Back to projects
          </button>
        }
      />

      <div className="workspace-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <b>Survey information</b>
              <span>Registered project metadata</span>
            </div>
            <span
              className={
                survey.status === 'READY'
                  ? 'status-ok'
                  : 'status-pending'
              }
            >
              {survey.status}
            </span>
          </div>

          <div className="workspace-info-grid">
            <div className="workspace-info">
              <span>Survey code</span>
              <b>{survey.survey_code}</b>
            </div>

            <div className="workspace-info">
              <span>Parcel reference</span>
              <b>{survey.parcel_id ?? 'Not assigned'}</b>
            </div>

            <div className="workspace-info">
              <span>Project name</span>
              <b>{survey.name}</b>
            </div>

            <div className="workspace-info">
              <span>Description</span>
              <b>{survey.description ?? 'No description'}</b>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <b>Survey workflow</b>
              <span>Next available operations</span>
            </div>
          </div>

          <div className="workspace-actions">
            <button
              className="workspace-action"
              onClick={() => onNavigate('upload')}
            >
              <CloudUpload size={19}/>
              <div>
                <b>Upload survey data</b>
                <span>Images, GNSS, GCP, checkpoints and logs</span>
              </div>
              <ArrowRight size={16}/>
            </button>

            <button
              className="workspace-action"
              onClick={() => onNavigate('processing')}
            >
              <Activity size={19}/>
              <div>
                <b>Processing</b>
                <span>Validation, photogrammetry and outputs</span>
              </div>
              <ArrowRight size={16}/>
            </button>

            <button
              className="workspace-action"
              onClick={() => onNavigate('orthomosaic')}
            >
              <Map size={19}/>
              <div>
                <b>Orthomosaic workspace</b>
                <span>Inspect processed survey imagery</span>
              </div>
              <ArrowRight size={16}/>
            </button>

            <button
              className="workspace-action"
              onClick={() => onNavigate('quality')}
            >
              <Gauge size={19}/>
              <div>
                <b>Survey quality</b>
                <span>Review technical survey readiness</span>
              </div>
              <ArrowRight size={16}/>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function UploadPage({
  survey,
  toast,
}: {
  survey: Survey
  toast: (message: string) => void
}) {
  const [files, setFiles] = useState<SurveyFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState('')
  const [validationMessage, setValidationMessage] = useState('')

  const loadFiles = () => {
    setLoading(true)
    setError('')

    getSurveyFiles(survey.id)
      .then(data => setFiles(data))
      .catch(err => {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load survey files'
        )
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadFiles()
  }, [survey.id])

  const handleFileSelection = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selected = Array.from(event.target.files ?? [])

    if (!selected.length) {
      return
    }

    setSelectedFiles(selected)
    setError('')
    setValidationMessage('')
  }

  const handleUpload = async () => {
    if (!selectedFiles.length) {
      setError('Select one or more files first.')
      return
    }

    setUploading(true)
    setError('')

    try {
      const result = await uploadSurveyFiles(
        survey.id,
        selectedFiles,
      )

      setSelectedFiles([])
      setValidationMessage(
        `${result.uploaded_count} file${
          result.uploaded_count === 1 ? '' : 's'
        } uploaded successfully.`,
      )

      if (result.skipped_count > 0) {
        setValidationMessage(
          `${result.uploaded_count} uploaded, ${result.skipped_count} skipped.`,
        )
      }

      await loadFiles()

      toast(
        `${result.uploaded_count} survey file${
          result.uploaded_count === 1 ? '' : 's'
        } uploaded`,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Survey file upload failed'
      )
    } finally {
      setUploading(false)
    }
  }

  const handleValidate = async () => {
    setValidating(true)
    setError('')
    setValidationMessage('')

    try {
      const result = await validateSurveyData(survey.id)

      setValidationMessage(
        `${result.image_count} image${
          result.image_count === 1 ? '' : 's'
        } detected. ${result.valid_files} valid, ${
          result.warning_files
        } warning, ${result.invalid_files} invalid.`,
      )

      await loadFiles()
      toast('Survey data validation completed')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Survey validation failed'
      )
    } finally {
      setValidating(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const typeCount = (type: string) =>
    files.filter(file => file.file_type === type).length

  return (
    <div>
      <PageHead
        eyebrow="DATA INGESTION"
        title="Survey data upload"
        subtitle={`${survey.survey_code} · ${survey.name}`}
        action={
          <label className="btn primary">
            <UploadCloud size={17}/>
            Select files
            <input
              type="file"
              multiple
              hidden
              onChange={handleFileSelection}
              disabled={uploading}
            />
          </label>
        }
      />

      <div className="notice-banner">
        <Database size={18}/>
        <div>
          <b>Connected survey storage</b>
          <span>
            Files are uploaded to the selected survey and registered
            with SHA-256 integrity metadata.
          </span>
        </div>
      </div>

      {error && (
        <div className="form-error upload-error">
          <X size={14}/>
          <span>{error}</span>
        </div>
      )}

      {validationMessage && (
        <div className="upload-success">
          <CheckCircle2 size={15}/>
          <span>{validationMessage}</span>
        </div>
      )}

      <section className="panel upload-selection">
        <div className="panel-head">
          <div>
            <b>Upload files</b>
            <span>
              Select multiple images, GNSS files, GCP data,
              checkpoints or flight logs.
            </span>
          </div>

          <button
            className="btn primary"
            disabled={!selectedFiles.length || uploading}
            onClick={handleUpload}
          >
            {uploading ? (
              <>
                <RefreshCw className="spin" size={15}/>
                Uploading...
              </>
            ) : (
              <>
                <UploadCloud size={15}/>
                Upload selected
              </>
            )}
          </button>
        </div>

        <div className="selected-file-list">
          {!selectedFiles.length && (
            <div className="upload-empty">
              <UploadCloud size={28}/>
              <b>No files selected</b>
              <span>
                Use “Select files” above to choose survey data.
              </span>
            </div>
          )}

          {selectedFiles.map((file, index) => (
            <div
              className="selected-file"
              key={`${file.name}-${index}`}
            >
              <FileImage size={16}/>
              <div>
                <b>{file.name}</b>
                <span>{formatBytes(file.size)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <b>Dataset manifest</b>
            <span>
              Files currently registered for {survey.survey_code}
            </span>
          </div>

          <button
            className="btn secondary"
            disabled={validating || loading}
            onClick={handleValidate}
          >
            {validating ? (
              <>
                <RefreshCw className="spin" size={15}/>
                Validating...
              </>
            ) : (
              <>
                <CheckCircle2 size={16}/>
                Validate survey data
              </>
            )}
          </button>
        </div>

        <div className="manifest">
          <ManifestRow
            n="01"
            name="Drone image set"
            requirement={`${typeCount('IMAGE')} files registered`}
          />
          <ManifestRow
            n="02"
            name="Raster data"
            requirement={`${typeCount('RASTER')} files registered`}
          />
          <ManifestRow
            n="03"
            name="GCP / coordinate data"
            requirement={`${typeCount('CSV')} CSV files registered`}
          />
          <ManifestRow
            n="04"
            name="GNSS observations"
            requirement={`${
              typeCount('GNSS_RINEX') +
              typeCount('GNSS_OBSERVATION') +
              typeCount('GNSS_NAVIGATION')
            } GNSS files registered`}
          />
          <ManifestRow
            n="05"
            name="Flight logs"
            requirement={`${typeCount('FLIGHT_LOG')} log files registered`}
          />
          <ManifestRow
            n="06"
            name="Archives"
            requirement={`${typeCount('ARCHIVE')} archive files registered`}
          />
        </div>
      </section>

      <section className="panel file-registry">
        <div className="panel-head">
          <div>
            <b>File registry</b>
            <span>
              {loading
                ? 'Loading'
                : `${files.length} file${
                    files.length === 1 ? '' : 's'
                  } registered`}
            </span>
          </div>

          <button
            className="icon-btn"
            onClick={loadFiles}
            disabled={loading}
            title="Refresh file registry"
          >
            <RefreshCw
              className={loading ? 'spin' : ''}
              size={16}
            />
          </button>
        </div>

        {loading && (
          <div className="upload-empty">
            <RefreshCw className="spin" size={25}/>
            <b>Loading survey files</b>
          </div>
        )}

        {!loading && files.length === 0 && (
          <div className="upload-empty">
            <FolderOpen size={27}/>
            <b>No files registered</b>
            <span>
              Upload survey data to populate this registry.
            </span>
          </div>
        )}

        {!loading && files.length > 0 && (
          <div className="file-registry-list">
            {files.map(file => (
              <div className="file-registry-row" key={file.id}>
                <div className="file-registry-icon">
                  <FileArchive size={16}/>
                </div>

                <div className="file-registry-main">
                  <b>{file.filename}</b>
                  <span>
                    {file.file_type} · {formatBytes(file.size_bytes)}
                  </span>
                </div>

                <div className="file-registry-hash">
                  <span>SHA-256</span>
                  <code>{file.sha256.slice(0, 16)}...</code>
                </div>

                <span
                  className={
                    file.validation_status === 'VALID'
                      ? 'status-ok'
                      : file.validation_status === 'INVALID'
                        ? 'status-invalid'
                        : 'status-pending'
                  }
                >
                  {file.validation_status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ManifestRow({n,name,requirement}:{n:string;name:string;requirement:string}) {
  return <div className="manifest-row"><span className="mono">{n}</span><b>{name}</b><span>{requirement}</span><i>Not connected</i></div>
}

function ProcessingPage({ survey }: { survey: Survey }) {
  const surveyId = survey.id

  const [job, setJob] = useState<ProcessingJob | null>(null)
  const [artifacts, setArtifacts] = useState<ProcessingArtifact[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const loadProcessing = async () => {
    setLoading(true)
    setError('')

    try {
      const [jobs, artifactData] = await Promise.all([
        getProcessingJobs(surveyId),
        getArtifacts(surveyId),
      ])

      const latestJob = jobs.length > 0 ? jobs[0] : null

      setJob(latestJob)
      setArtifacts(artifactData)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load processing data'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProcessing()
  }, [surveyId])

  const handleStartOrthomosaic = async () => {
    setStarting(true)
    setError('')

    try {
      const newJob = await startOrthomosaic(surveyId)

      setJob(newJob)

      await loadProcessing()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start orthomosaic processing'
      )
    } finally {
      setStarting(false)
    }
  }

  const completed = job?.status === 'COMPLETED'
  const failed = job?.status === 'FAILED'
  const active =
    job?.status === 'QUEUED' ||
    job?.status === 'RUNNING'

  const stages = [
    [
      'Input validation',
      'Validate images, metadata, CRS and control points',
    ],
    [
      'GNSS / PPK',
      'Produce trajectory / position quality',
    ],
    [
      'Photogrammetry',
      'Feature matching and bundle adjustment',
    ],
    [
      'Dense reconstruction',
      'Point cloud and surface generation',
    ],
    [
      'Orthomosaic',
      'Generate georeferenced raster',
    ],
    [
      'Quality gate',
      'Check GCP / checkpoint / reconstruction quality',
    ],
  ]

  const stageProgress = [
    10,
    20,
    45,
    65,
    85,
    100,
  ]

  const currentStageIndex = (() => {
    if (!job) {
      return -1
    }

    if (completed) {
      return stages.length - 1
    }

    if (failed) {
      return -1
    }

    const progress = job.progress ?? 0

    if (progress < 10) return 0
    if (progress < 20) return 1
    if (progress < 45) return 2
    if (progress < 65) return 3
    if (progress < 85) return 4

    return 5
  })()

  return (
    <div>
      <PageHead
        eyebrow="PROCESSING"
        title="Processing pipeline"
        subtitle="Live processing state from the ELIOS-LAND backend."
        action={
          <div style={{display: 'flex', gap: '8px'}}>
            <button
              className="btn secondary"
              onClick={loadProcessing}
              disabled={loading || starting}
            >
              <RefreshCw
                className={loading ? 'spin' : ''}
                size={16}
              />
              {loading ? 'Refreshing' : 'Refresh job'}
            </button>

            <button
              className="btn primary"
              onClick={handleStartOrthomosaic}
              disabled={loading || starting || active}
            >
              <Play size={16}/>
              {starting
                ? 'Starting...'
                : active
                  ? 'Processing...'
                  : completed
                    ? 'Run again'
                    : 'Start processing'}
            </button>
          </div>
        }
      />

      <div className="job-layout">
        <section className="panel">
          <div className="panel-head">
            <div>
              <b>Orthomosaic job</b>
              <span>
                {job ? job.id : 'No processing job'}
              </span>
            </div>

            {loading && <span className="status-pending">Loading</span>}
            {!loading && completed && <span className="status-ok">COMPLETED</span>}
            {!loading && failed && <span className="status-pending">FAILED</span>}
            {!loading && !completed && !failed && job && (
              <span className="status-pending">{job.status}</span>
            )}
            {!loading && !job && (
              <span className="status-pending">NOT STARTED</span>
            )}
          </div>

          {error && (
            <div className="empty">
              <X size={30}/>
              <b>Processing error</b>
              <p>{error}</p>
              <button className="btn secondary" onClick={loadProcessing}>
                Retry
              </button>
            </div>
          )}

          {!error && stages.map((stage, i) => {
            const stageComplete =
              completed ||
              (
                active &&
                job.progress >= stageProgress[i]
              )

            const stageCurrent =
              active &&
              !stageComplete &&
              i === currentStageIndex

            const stageFailed =
              failed &&
              i === currentStageIndex

            return (
              <div className="job-stage" key={stage[0]}>
                <div className={`stage-icon ${stageCurrent ? 'active' : ''}`}>
                  {stageComplete ? (
                    <CheckCircle2 size={16}/>
                  ) : stageCurrent ? (
                    <RefreshCw className="spin" size={16}/>
                  ) : stageFailed ? (
                    <X size={16}/>
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>

                <div>
                  <b>{stage[0]}</b>
                  <span>{stage[1]}</span>
                </div>

                <div className="stage-state">
                  {stageComplete
                    ? 'COMPLETED'
                    : stageCurrent
                      ? `${job?.progress ?? 0}%`
                      : stageFailed
                        ? 'FAILED'
                        : 'WAITING'}
                </div>
              </div>
            )
          })}

          {!loading && job && (
            <div className="panel" style={{marginTop: '16px'}}>
              <div className="panel-head">
                <div>
                  <b>Backend message</b>
                  <span>{job.job_type}</span>
                </div>
                <b>{job.progress}%</b>
              </div>
              <p>{job.message ?? 'No processing message.'}</p>
              {job.error_message && (
                <p>
                  <b>Error:</b>{' '}
                  {job.error_message}
                </p>
              )}
            </div>
          )}
        </section>

        <aside className="panel job-side">
          <div className="panel-head">
            <div>
              <b>Job outputs</b>
              <span>
                {artifacts.length} registered
              </span>
            </div>
          </div>

          {artifacts.length === 0 && !loading && (
            <div className="empty">
              <Database size={28}/>
              <b>No artifacts found</b>
              <p>No processing outputs are registered for this survey.</p>
            </div>
          )}

          {([
            {
              type: 'ORTHOMOSAIC',
              fallbackName: 'Survey Orthomosaic',
              Icon: FileArchive,
            },
            {
              type: 'DSM',
              fallbackName: 'Digital Surface Model',
              Icon: Layers3,
            },
            {
              type: 'POINT_CLOUD_EPT',
              fallbackName: 'Entwine Point Cloud',
              Icon: Database,
            },
          ]).map(
            ({
              type,
              fallbackName,
              Icon,
            }) => {
              const artifact =
                artifacts.find(
                  a => a.artifact_type === type
                )

              return (
                <div
                  className="output-card"
                  key={type}
                >
                  <Icon size={19}/>

                  <div>
                    <b>
                      {artifact?.name ??
                        fallbackName}
                    </b>

                    <span>
                      {artifact
                        ? `${artifact.file_format.toUpperCase()} · ${Math.round(
                            artifact.size_bytes /
                              1024 /
                              1024
                          )} MB`
                        : 'Not generated'}
                    </span>
                  </div>

                  {artifact &&
                    type !== 'POINT_CLOUD_EPT' && (
                      <a
                        className="icon-btn"
                        href={`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/surveys/${surveyId}/artifacts/${artifact.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        title="Download artifact"
                      >
                        <ArrowRight size={15}/>
                      </a>
                    )}

                  {artifact &&
                    type === 'POINT_CLOUD_EPT' && (
                      <span
                        className="stage-state"
                        title="EPT point cloud is stored as a tiled dataset"
                      >
                        EPT
                      </span>
                    )}
                </div>
              )
            }
          )}
        </aside>
      </div>
    </div>
  )
}

function OrthomosaicPage({
  survey,
  selectedLayer,
  setSelectedLayer,
  toast,
}: {
  survey: Survey | null
  selectedLayer: string
  setSelectedLayer: (s: string) => void
  toast: (s: string) => void
}) {
  const surveyId = survey?.id ?? null

  const [info, setInfo] = useState<import('../api/orthomosaic').OrthomosaicInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const previewUrl = surveyId
    ? `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/surveys/${surveyId}/orthomosaic/preview`
    : ''

  useEffect(() => {
    if (!surveyId) {
      setInfo(null)
      setError('Select a survey project before opening the orthomosaic workspace.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    import('../api/orthomosaic')
      .then(({ getOrthomosaicInfo }) => getOrthomosaicInfo(surveyId))
      .then(data => setInfo(data))
      .catch(err => {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load orthomosaic information'
        )
      })
      .finally(() => setLoading(false))
  }, [surveyId])

  const resolution = info
    ? `${info.resolution[0].toFixed(3)} m/pixel`
    : '—'

  const rasterSize = info
    ? `${info.width} × ${info.height}`
    : '—'

  return (
    <div>
      <PageHead
        eyebrow="GIS WORKSPACE"
        title="Orthomosaic workspace"
        subtitle="Real processed survey imagery generated from the ELIOS-LAND photogrammetry pipeline."
        action={
          <button
            className="btn primary"
            onClick={() => toast('Orthomosaic view ready for export')}
          >
            <PackageCheck size={16}/>
            Export view
          </button>
        }
      />

      <div className="map-layout">
        <section className="map-panel">
          <div className="map-toolbar">
            <div className="map-title">
              <Map size={17}/>
              <b>Survey orthomosaic</b>
              <span>
                {loading
                  ? 'LOADING'
                  : error
                    ? 'ERROR'
                    : 'RASTER LOADED'}
              </span>
            </div>

            <div className="map-actions">
              <button
                className="icon-btn"
                onClick={() => window.open(previewUrl, '_blank')}
                title="Open raster preview"
              >
                <FileImage size={16}/>
              </button>

              <button
                className="icon-btn"
                onClick={() => toast('Map controls will be expanded with boundary and measurement tools')}
                title="Map controls"
              >
                <SlidersHorizontal size={16}/>
              </button>
            </div>
          </div>

          <div
            className="map-canvas"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
              background: '#111827',
            }}
          >
            {loading && (
              <div className="empty">
                <RefreshCw className="spin" size={32}/>
                <b>Loading orthomosaic</b>
                <p>Reading raster metadata from the backend.</p>
              </div>
            )}

            {!loading && error && (
              <div className="empty">
                <X size={32}/>
                <b>Unable to load orthomosaic</b>
                <p>{error}</p>
              </div>
            )}

            {!loading && !error && info && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <img
                  src={previewUrl}
                  alt={`${survey?.survey_code ?? "Survey"} processed orthomosaic`}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />

                <div className="map-label parcel-label">
                  {survey?.survey_code ?? 'SURVEY'} · ORTHOMOSAIC
                </div>
              </div>
            )}

            <div className="map-legend">
              <b>Layers</b>
              {futureMapLayers.map(l => (
                <label key={l}>
                  <input
                    type="checkbox"
                    checked={selectedLayer === l}
                    onChange={() => setSelectedLayer(l)}
                  />
                  {l}
                </label>
              ))}
            </div>

            <div className="map-scale">
              {info ? `${resolution}` : '—'}
            </div>
          </div>
        </section>

        <aside className="map-sidebar">
          <div className="side-block">
            <span className="side-label">PROJECT</span>
            <b>{survey?.survey_code ?? 'No survey selected'}</b>
            <p>Parcel-linked survey workspace</p>
          </div>

          <div className="side-block">
            <span className="side-label">ACTIVE LAYER</span>
            <div className="layer-active">
              <span className="layer-dot"/>
              {selectedLayer}
            </div>
          </div>

          <div className="side-block">
            <span className="side-label">RASTER INFORMATION</span>

            <div className="kv">
              <span>CRS</span>
              <b>{info?.crs ?? '—'}</b>
            </div>

            <div className="kv">
              <span>Raster size</span>
              <b>{rasterSize}</b>
            </div>

            <div className="kv">
              <span>Resolution</span>
              <b>{resolution}</b>
            </div>

            <div className="kv">
              <span>Bands</span>
              <b>{info?.bands ?? '—'}</b>
            </div>
          </div>

          <div className="side-block">
            <span className="side-label">MAP TOOLS</span>

            <div className="tool-list">
              <button
                onClick={() => toast('Identify tool will query geospatial features from the backend')}
              >
                Identify feature
              </button>

              <button
                onClick={() => toast('Measurement will use the raster CRS and survey geometry')}
              >
                Measure distance / area
              </button>

              <button
                onClick={() => toast('Boundary editor will be connected after boundary extraction')}
              >
                Edit boundary
              </button>
            </div>
          </div>

          <div className="side-block">
            <span className="side-label">DATA STATUS</span>

            <div className="kv">
              <span>Orthomosaic</span>
              <b>{info ? 'Loaded' : 'Not loaded'}</b>
            </div>

            <div className="kv">
              <span>Cadastral</span>
              <b>Not loaded</b>
            </div>

            <div className="kv">
              <span>Observed boundary</span>
              <b>Not loaded</b>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function QualityPage() {
  return <div><PageHead eyebrow="QUALITY GATE" title="Survey quality" subtitle="Quality is evaluated before geometry comparison is treated as meaningful." />
    <div className="quality-grid">{[
      ['GCP quality','—','Control residuals','Waiting'],
      ['Checkpoint RMSE','—','Independent accuracy','Waiting'],
      ['GNSS quality','—','Fix / residual statistics','Waiting'],
      ['Orthomosaic quality','—','Reconstruction diagnostics','Waiting'],
      ['CRS / georeference','—','Coordinate reference check','Waiting'],
      ['Overall gate','—','Technical readiness','Waiting']
    ].map(x=><div className="quality-card" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><small>{x[2]}</small><em>{x[3]}</em></div>)}</div>
  </div>
}

function BoundaryPage({toast}:{toast:(s:string)=>void}) {
  return <div><PageHead eyebrow="BOUNDARY EXTRACTION" title="AI + human boundary review" subtitle="Observed physical boundary candidates are created from the orthomosaic and reviewed by a human operator." action={<button className="btn primary" onClick={()=>toast('AI model endpoint will be connected later')}><Sparkles size={16}/> Run AI candidate</button>} />
    <div className="boundary-layout"><div className="panel boundary-canvas"><div className="canvas-note"><Sparkles size={16}/> AI-assisted observed boundary · not legal ownership determination</div><div className="fake-image"><div className="fake-field"></div><div className="fake-boundary"></div></div><div className="edit-bar"><button className="btn secondary" onClick={()=>toast('Vertex editor will be connected later')}>Edit vertices</button><button className="btn secondary" onClick={()=>toast('Redraw tool will be connected later')}>Redraw</button><button className="btn primary" onClick={()=>toast('Boundary version save will be connected later')}><CheckCircle2 size={15}/> Accept version</button></div></div>
      <aside className="panel boundary-side"><b>Boundary versions</b><div className="version"><div><b>Candidate 01</b><span>AI generated · pending review</span></div><span className="status-pending">REVIEW</span></div><div className="version muted"><div><b>Recorded parcel</b><span>Source cadastral geometry</span></div><span>REFERENCE</span></div><hr/><div className="mini-stat"><span>Vertices</span><b>—</b></div><div className="mini-stat"><span>Observed area</span><b>—</b></div><div className="mini-stat"><span>Confidence</span><b>—</b></div></aside>
    </div>
  </div>
}

function ComparisonPage() {
  return <div><PageHead eyebrow="GEOMETRY ANALYSIS" title="Cadastral comparison" subtitle="Recorded geometry and observed physical boundary will be compared after the orthomosaic and boundary are available." />
    <div className="comparison-grid"><section className="panel compare-main"><div className="compare-visual"><div className="compare-shape recorded"></div><div className="compare-shape observed"></div><div className="compare-key"><span><i className="key recorded-k"/>Recorded</span><span><i className="key observed-k"/>Observed</span></div></div></section><section className="panel metrics"><b>Comparison metrics</b>{['Recorded area','Observed area','Area difference','Mean boundary difference','Maximum boundary difference','Centroid shift','Combined uncertainty','Displacement / uncertainty'].map(m=><div className="metric-row" key={m}><span>{m}</span><b>—</b></div>)}<div className="result-box"><span>Technical status</span><b>Awaiting survey data</b></div></section></div>
  </div>
}

function VerificationPage() {
  return <div><PageHead eyebrow="FIELD VERIFICATION" title="Verification cases" subtitle="Cases that require field measurements, photos or surveyor review will appear here." action={<button className="btn primary"><Plus size={16}/> New case</button>} />
    <section className="panel"><div className="empty"><ShieldCheck size={34}/><b>No verification cases loaded</b><p>Future API: <code>GET /cases</code> and field-sync endpoints.</p><div className="feature-chips"><span>GNSS point</span><span>Photo evidence</span><span>Offline notes</span><span>Sync queue</span></div></div></section>
  </div>
}

function EvidencePage({toast}:{toast:(s:string)=>void}) {
  return <div><PageHead eyebrow="EVIDENCE" title="Evidence & reports" subtitle="Package source data, processing outputs, analysis results and audit information into a reproducible evidence set." action={<button className="btn primary" onClick={()=>toast('Evidence generation endpoint will be connected later')}><Archive size={16}/> Generate package</button>} />
    <div className="evidence-grid">{['Cadastral source','Survey metadata','Raw imagery','GNSS / PPK','GCP + checkpoints','Orthomosaic / DSM','Boundary versions','Comparison + uncertainty','Field evidence','Audit manifest'].map((x,i)=><div className="evidence-item" key={x}><div className="evidence-num">{String(i+1).padStart(2,'0')}</div><div><b>{x}</b><span>Awaiting backend object</span></div><MoreHorizontal size={16}/></div>)}</div>
  </div>
}

export default App
