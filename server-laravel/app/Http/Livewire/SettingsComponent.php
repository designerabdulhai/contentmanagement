<?php

namespace App\Http\Livewire;

use Livewire\Component;
use App\Models\SettingOption;
use App\Models\Template;

class SettingsComponent extends Component
{
    public $options = [];

    public function mount(){ $this->options = SettingOption::all()->groupBy('type'); }

    public function render(){ return view('livewire.settings-component'); }
}
