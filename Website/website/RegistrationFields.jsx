// Adapted from CommunityConnect-WebApp src/registration/AnswerField.jsx,
// revision 97ee4514022f331bdc1af375dddb09b2f91b4603.
import React,{useId} from 'react';
export function AnswerField({field,value,error,onChange}){
 const id=useId(),title=field.label+(field.required?' *':'');
 const common={id,'aria-describedby':`${id}-help ${id}-error`,'aria-invalid':Boolean(error),'aria-required':field.required};
 const choice=['radio','checkboxes'].includes(field.type);
 return <div className="registration-answer">
 {choice?<fieldset {...common}><legend>{title}</legend><p className="registration-help" id={id+'-help'}>{field.description}</p>{field.options.map(option=><label className="registration-check" key={option}><input type={field.type==='radio'?'radio':'checkbox'} name={id} checked={field.type==='radio'?value===option:Array.isArray(value)&&value.includes(option)} onChange={event=>onChange(field.type==='radio'?option:event.target.checked?[...(value||[]),option]:(value||[]).filter(item=>item!==option))}/><span>{option}</span></label>)}</fieldset>
 :<><label htmlFor={id}>{title}</label><p className="registration-help" id={id+'-help'}>{field.description}</p>
 {field.type==='textarea'?<textarea {...common} value={value||''} maxLength={2000} onChange={event=>onChange(event.target.value)}/>
 :field.type==='select'?<select {...common} value={value||''} onChange={event=>onChange(event.target.value)}><option value="">Choose an option</option>{field.options.map(option=><option key={option}>{option}</option>)}</select>
 :field.type==='consent'?<><p className="registration-terms">{field.terms}</p><label className="registration-check"><input {...common} type="checkbox" checked={value===true} onChange={event=>onChange(event.target.checked)}/>I agree to these terms and conditions</label></>
 :<input {...common} type={{email:'email',phone:'tel',number:'number',date:'date'}[field.type]||'text'} step={field.type==='number'?'any':undefined} value={value??''} maxLength={2000} onChange={event=>onChange(event.target.value)}/>}</>}
 <p id={id+'-error'} role={error?'alert':undefined}>{error||''}</p></div>;
}
export default function RegistrationFields({fields,answers,errors={},onChange}){
 return fields.map(field=><AnswerField key={field.id} field={field} value={answers[field.id]} error={errors[field.id]} onChange={value=>onChange(field.id,value)}/>);
}
