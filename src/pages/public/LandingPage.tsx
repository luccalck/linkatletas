import {
  Target,
  ShieldCheck,
  Dumbbell,
  ArrowRight,
  X,
  Menu,
  Sparkles,
  Star,
  Check,
  ChevronDown,
  MessageSquare,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../../components/Logo'
import { SPORTS } from '../../../shared/contracts'
import heroTraining from '../../assets/hero-training.webp'

const benefits = [
  { icon: Target, title: 'Matches que fazem sentido', text: 'Modalidade, objetivos, orçamento e disponibilidade cruzados para indicar o profissional certo.' },
  { icon: ShieldCheck, title: 'Profissionais verificados', text: 'O perfil só é liberado após a conferência do CREF e da documentação pela administração.' },
  { icon: Dumbbell, title: 'Treino em um só lugar', text: 'Planejamento, vídeos, feedbacks e métricas organizados em uma experiência contínua.' },
]

export function LandingPage() {
  const [open, setOpen] = useState(false)
  const [faq, setFaq] = useState<number | null>(0)
  useEffect(() => { window.scrollTo(0, 0) }, [])

  return <div className="landing">
    <header className="public-header">
      <Link to="/" aria-label="Página inicial"><Logo light /></Link>
      <nav id="public-navigation" className={open ? 'open' : ''}>
        <a href="#como-funciona" onClick={() => setOpen(false)}>Como funciona</a>
        <a href="#recursos" onClick={() => setOpen(false)}>Recursos</a>
        <a href="#seguranca" onClick={() => setOpen(false)}>Segurança</a>
        <a href="#perguntas" onClick={() => setOpen(false)}>Perguntas</a>
        <Link className="button button--ghost-light nav-mobile-login" to="/login">Entrar</Link>
      </nav>
      <div className="public-header__actions"><Link className="header-login" to="/login">Entrar</Link><Link className="button button--accent" to="/login">Começar agora <ArrowRight size={17} /></Link><button className="menu-toggle" aria-label={open ? 'Fechar menu' : 'Abrir menu'} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div>
    </header>

    <main>
      <section className="hero">
        <img className="hero__image" src={heroTraining} alt="Atleta treinando em uma pista com orientação de treinador" />
        <div className="hero__overlay" />
        <div className="hero__content container">
          <span className="hero__tag"><Sparkles size={14} /> Sua evolução encontra direção</span>
          <h1>O treinador certo.<br /><em>Seu próximo nível.</em></h1>
          <p>Conectamos atletas a profissionais verificados e reunimos toda a jornada de treino em uma plataforma simples, segura e humana.</p>
          <div className="hero__buttons"><Link className="button button--accent button--large" to="/login?perfil=atleta">Encontrar treinador <ArrowRight size={19} /></Link><Link className="button button--glass button--large" to="/login?perfil=treinador">Sou treinador</Link></div>
          <div className="hero__trust"><div className="avatar-stack"><i>MC</i><i>RN</i><i>BL</i></div><div><span><Star size={13} fill="currentColor" /> Avaliações por vínculo</span><small>Treinos mais inteligentes, todos os dias.</small></div></div>
        </div>
        <div className="hero__metric"><span>Exemplo de acompanhamento</span><strong>92%</strong><small>dados ilustrativos de conclusão</small><div><i style={{ height: '43%' }} /><i style={{ height: '65%' }} /><i style={{ height: '51%' }} /><i style={{ height: '78%' }} /><i style={{ height: '87%' }} /><i style={{ height: '94%' }} /><i className="current" style={{ height: '72%' }} /></div></div>
      </section>

      <section className="proof-strip"><div className="container"><span>Feito para quem leva a evolução a sério</span><div><b>{SPORTS.length}</b> modalidades</div><div><b>CREF</b> conferência documental</div><div><b>Online</b> ou híbrido</div><div><b>Privacidade</b> por finalidade</div></div></section>

      <section className="section section--light" id="recursos"><div className="container">
        <div className="section-intro"><span className="eyebrow">Uma conexão completa</span><h2>Do primeiro match à melhor performance.</h2><p>Menos ferramentas desconectadas. Mais tempo para treinar, orientar e acompanhar o que realmente importa.</p></div>
        <div className="benefit-grid">{benefits.map(({ icon: Icon, title, text }, index) => <article className="benefit-card" key={title}><span className="benefit-card__number">0{index + 1}</span><div className="benefit-card__icon"><Icon /></div><h3>{title}</h3><p>{text}</p><a href="#como-funciona">Entenda como <ArrowRight size={15} /></a></article>)}</div>
      </div></section>

      <section className="section journey" id="como-funciona"><div className="container journey__grid"><div>
        <span className="eyebrow">Para atletas</span><h2>Seu objetivo deixa de ser um plano distante.</h2><p>Conte onde você está e aonde quer chegar. A LinkAtletas encontra profissionais compatíveis e acompanha cada passo da sua jornada.</p>
        <ol className="steps"><li><b>01</b><div><strong>Crie seu perfil esportivo</strong><span>Modalidade, nível, objetivo e rotina em poucos minutos.</span></div></li><li><b>02</b><div><strong>Compare seus melhores matches</strong><span>Veja compatibilidade, avaliações, metodologia e valor.</span></div></li><li><b>03</b><div><strong>Treine e evolua com clareza</strong><span>Receba seu plano, envie feedback e acompanhe métricas.</span></div></li></ol>
        <Link className="text-link" to="/login?perfil=atleta">Explorar como atleta <ArrowRight size={16} /></Link>
      </div><div className="phone-scene"><p className="eyebrow">Prévia ilustrativa — dados fictícios</p>
        <div className="phone"><div className="phone__top"><span>9:41</span><i /></div><div className="phone__head"><div><small>Bom dia, Marina</small><strong>Vamos evoluir?</strong></div><span>MC</span></div><div className="phone__streak"><span>Sequência atual</span><strong>8 dias</strong><div>🔥</div></div><small className="phone__label">Treino de hoje</small><div className="phone__workout"><div className="phone__play">▶</div><div><strong>Intervalado 6 × 800 m</strong><span>52 min · Intensidade alta</span></div></div><div className="phone__coach"><span>AM</span><div><small>Seu treinador</small><strong>André Martins</strong><i>“Ritmo perfeito. Vamos manter!”</i></div></div><div className="phone__nav"><i>⌂</i><i>⌕</i><i>◉</i><i>◇</i></div></div>
        <div className="float-card float-card--match"><span><Check /></span><div><small>Novo match</small><strong>96% compatível</strong></div></div><div className="float-card float-card--review"><Star fill="currentColor" /><div><strong>4,9</strong><small>126 avaliações</small></div></div>
      </div></div></section>

      <section className="section coach-band"><div className="container coach-band__grid"><div className="coach-visual"><div className="coach-visual__panel"><div className="mini-top"><span>Desempenho da equipe</span><b>Dados ilustrativos</b></div><div className="mini-stats"><span><small>Alunos ativos</small><strong>28 <i>+12%</i></strong></span><span><small>Adesão média</small><strong>92%</strong></span></div><div className="mini-chart"><svg viewBox="0 0 400 130" preserveAspectRatio="none"><path d="M0 102 C40 95,45 76,83 82 S135 53,170 62 S220 33,255 48 S320 17,400 24" fill="none" stroke="#d7f266" strokeWidth="4"/><path d="M0 102 C40 95,45 76,83 82 S135 53,170 62 S220 33,255 48 S320 17,400 24 L400 130 L0 130Z" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d7f266" stopOpacity=".35"/><stop offset="1" stopColor="#d7f266" stopOpacity="0"/></linearGradient></defs></svg></div><div className="mini-athletes"><span>MC</span><span>RN</span><span>CR</span><div><strong>Marina concluiu o treino</strong><small>Agora · 92% de aderência</small></div></div></div></div><div className="coach-band__copy"><span className="eyebrow">Para treinadores</span><h2>Mais gestão.<br />Mais alunos.<br /><em>Menos operação.</em></h2><p>Centralize sua carteira, prescreva treinos e acompanhe o desempenho dos atletas. Pagamentos dependem da configuração do provedor.</p><ul><li><Check /> Painel de alunos e alertas de atenção</li><li><Check /> Biblioteca e prescrição de treinos</li><li><Check /> Feedbacks, vídeos e mensagens</li><li><Check /> Pagamentos recorrentes com split</li></ul><Link className="button button--accent" to="/login?perfil=treinador">Conhecer painel do treinador <ArrowRight size={17} /></Link></div></div></section>

      <section className="section security" id="seguranca"><div className="container"><div className="security__icon"><ShieldCheck /></div><div><span className="eyebrow">Confiança não é opcional</span><h2>Proteção para quem treina.<br />Credibilidade para quem orienta.</h2></div><div className="security__items"><article><strong>CREF validado</strong><p>Nenhum treinador é publicado sem comprovação profissional.</p></article><article><strong>Privacidade por padrão</strong><p>Consentimento por finalidade e acesso restrito aos dados privados.</p></article><article><strong>Pagamento protegido</strong><p>Checkout e divisão de valores disponíveis quando o provedor estiver configurado.</p></article></div></div></section>

      <section className="section faq" id="perguntas"><div className="container faq__grid"><div><span className="eyebrow">Perguntas frequentes</span><h2>Antes de começar, vale saber.</h2><p>A LinkAtletas foi desenhada para deixar a jornada clara desde o primeiro acesso.</p></div><div>{[
        ['Preciso ser atleta profissional?', 'Não. A plataforma atende desde quem está começando até atletas de alto rendimento. O match considera seu nível atual e seu objetivo.'],
        ['Como os treinadores são verificados?', 'O cadastro profissional exige CREF e documentação. A administração faz a conferência manual, e o perfil permanece bloqueado até a aprovação.'],
        ['Posso ter acompanhamento 100% remoto?', 'Sim. Você pode filtrar entre atendimento online, presencial ou híbrido, conforme sua rotina e localização.'],
        ['Meus dados de saúde ficam seguros?', 'Os dados de saúde exigem consentimento específico e acesso autenticado. Você pode revogar esse consentimento na área de privacidade.'],
      ].map(([q, a], i) => <article className={`faq-item ${faq === i ? 'open' : ''}`} key={q}><button aria-expanded={faq === i} aria-controls={`faq-answer-${i}`} onClick={() => setFaq(faq === i ? null : i)}><span>{q}</span><ChevronDown /></button><div id={`faq-answer-${i}`} aria-hidden={faq !== i}><p>{a}</p></div></article>)}</div></div></section>

      <section className="cta"><div className="container"><span className="eyebrow">Seu próximo passo começa agora</span><h2>Uma conexão pode mudar<br />toda a sua trajetória.</h2><p>Seja para encontrar direção ou ampliar seu impacto, há um lugar para você na LinkAtletas.</p><div><Link className="button button--accent button--large" to="/login?perfil=atleta">Quero evoluir <ArrowRight size={18} /></Link><Link className="button button--ghost-light button--large" to="/login?perfil=treinador">Quero treinar atletas</Link></div></div></section>
    </main>

    <footer className="footer"><div className="container"><div className="footer__brand"><Logo light /><p>Conexões que transformam esforço em evolução.</p></div><div><strong>Plataforma</strong><a href="#como-funciona">Como funciona</a><a href="#recursos">Recursos</a><Link to="/login">Entrar</Link></div><div><strong>Confiança</strong><a href="#seguranca">Segurança</a><a href="#seguranca">Privacidade</a><a href="#seguranca">LGPD</a></div><div><strong>Projeto</strong><span>SENAI Félix Guisard</span><span>Equipe LinkAtletas</span><span>Projeto Integrador II</span></div></div><div className="footer__bottom container"><span>© 2026 LinkAtletas. Projeto acadêmico.</span><span>Feito para conectar movimento e propósito.</span></div></footer>
    <a className="whatsapp" href="#perguntas" aria-label="Perguntas frequentes" title="Perguntas frequentes"><MessageSquare size={21} /></a>
  </div>
}
