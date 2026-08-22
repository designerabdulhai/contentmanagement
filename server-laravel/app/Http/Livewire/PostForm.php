<?php

namespace App\Http\Livewire;

use Livewire\Component;
use App\Models\ScheduledPost;
use App\Models\Template;

class PostForm extends Component
{
    public $postId;
    public $state = [];
    public $templates = [];

    public function mount($id = null){
        $this->templates = Template::orderBy('created_at','desc')->get();
        if($id){ $this->postId = $id; $this->state = ScheduledPost::find($id)->toArray(); }
        else{ $this->state = [ 'status'=>'listed' ]; }
    }

    public function save(){
        $data = $this->state;
        if($this->postId){ $p = ScheduledPost::find($this->postId); $p->update($data); }
        else{ ScheduledPost::create(array_merge($data, ['created_by'=>auth()->id()])); }
        $this->emit('postSaved');
    }

    public function useTemplate($templateId){
        $t = Template::find($templateId);
        if($t){ $this->state['content_type']=$t->content_type; $this->state['channel']=$t->channel; $this->state['platform']=$t->platform; }
    }

    public function saveAsTemplate($name){
        Template::create(['name'=>$name,'content_type'=>$this->state['content_type']??null,'channel'=>$this->state['channel']??null,'platform'=>$this->state['platform']??null,'created_by'=>auth()->id()]);
        $this->templates = Template::orderBy('created_at','desc')->get();
    }

    public function render(){ return view('livewire.post-form'); }
}
