import React from 'react';
import AdminBackButton from './AdminBackButton.jsx';

export default class WorkspaceBoundary extends React.Component {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error){console.error('Workspace could not open.',error);}
 render(){
  if(this.state.failed)return <section className="admin-console"><AdminBackButton/><h1>Workspace could not open</h1><p role="alert">Check your connection and reload to try again.</p><button type="button" className="btn" onClick={()=>location.reload()}>Reload</button></section>;
  return this.props.children;
 }
}
